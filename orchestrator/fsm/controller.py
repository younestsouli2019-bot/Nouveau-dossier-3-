"""Repository merge FSM: hardened push, redacted logs, resumable states."""
from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from .types import FSMError, Outcome, State, TRANSITIONS

_SECRET_PATTERNS = [
    re.compile(r"(https://)[^@\s/]*@"),          # token embedded in a remote URL
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{16,})"),
    re.compile(r"\b(shpat_[A-Za-z0-9]+)"),
]

_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")

_LOCKOUT_SIGNATURES = (
    "push declined due to repository rule violations",
    "protected branch",
    "gh006",
    "repository rule violations",
)

_NOT_FAST_FORWARD = ("non-fast-forward", "fetch first", "rejected")


def redact(text: str) -> str:
    """Strip credentials before anything reaches a log or audit sink."""
    out = text or ""
    for pattern in _SECRET_PATTERNS:
        out = pattern.sub(lambda m: (m.group(1) + "<redacted>@") if m.lastindex else "<redacted>", out)
    return out


class OrchestratorFSMController:
    def __init__(self, config: Dict[str, Any], checkpoint_store: Any, audit_log: Any):
        self.config = config
        self.checkpoint_store = checkpoint_store
        self.audit_log = audit_log
        self.current_state = State.MERGING
        self.timeout_s = int(config.get("git_timeout_s", 120))

    # ---------- guards ----------
    def _transition(self, target: State) -> None:
        if target not in TRANSITIONS[self.current_state]:
            raise FSMError(f"Illegal transition {self.current_state} -> {target}")
        self.current_state = target

    @staticmethod
    def _valid_ref(name: str, kind: str) -> str:
        if not _REF_RE.match(name or "") or ".." in name:
            raise FSMError(f"Unsafe {kind}: {name!r}")
        return name

    # ---------- git ----------
    def _git(self, args: list[str]) -> Tuple[int, str]:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        try:
            res = subprocess.run(
                ["git", *args],
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout_s,
                env=env,
            )
            return res.returncode, redact((res.stderr or "") + (res.stdout or ""))
        except subprocess.TimeoutExpired:
            return 124, f"timeout after {self.timeout_s}s"
        except Exception as exc:  # noqa: BLE001 - reported, never raised as a crash
            return 1, redact(str(exc))

    def export_patch(self, base: str = "origin/main", dest_dir: Optional[str] = None) -> Tuple[bool, str, str]:
        """Write the unpushed delta to a timestamped patch, atomically, mode 0600.

        Returns (ok, path, detail). An empty delta is a success with no path.
        The patch contains diffs: keep the directory gitignored.
        """
        rc, out = self._git(["diff", "--binary", base, "HEAD"])
        if rc != 0:
            return False, "", f"diff failed: {out[:200]}"
        if not out.strip():
            return True, "", "nothing to export"
        directory = dest_dir or self.config.get("export_dir") or "pending-shopify-parity"
        os.makedirs(directory, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(directory, f"pending-{stamp}.patch")
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(out)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        return True, path, f"{len(out)} bytes"

    def _execute_push_cmd(self, remote: str, branch: str) -> Tuple[bool, str]:
        """Push with an argv list, a -- separator and a hard timeout."""
        if not remote or remote.startswith("-"):
            raise FSMError(f"Unsafe remote: {remote!r}")
        branch = self._valid_ref(branch, "branch")
        code, trace = self._git(["push", "--", remote, f"HEAD:refs/heads/{branch}"])
        return code == 0, trace

    def _remote_matches_head(self, remote: str, branch: str) -> Optional[bool]:
        """Best-effort confirmation that the remote ref now equals HEAD."""
        head_code, head = self._git(["rev-parse", "HEAD"])
        ref_code, ref = self._git(["ls-remote", "--heads", remote, branch])
        if head_code != 0 or ref_code != 0 or not ref.strip():
            return None
        return ref.split()[0] == head.strip()

    def resume(self) -> State:
        """Return a suspended or degraded controller to MERGING."""
        self._transition(State.MERGING)
        return self.current_state

    def attempt_remote_merge(self, remote: str = "origin", branch: str = "main") -> str:
        """Run the merge attempt. Resumable from suspend and degraded states."""
        if self.current_state != State.MERGING:
            self._transition(State.MERGING)

        checkpoint = self.checkpoint_store.write(
            state="PRE_PUSH_REMOTE_SYNC",
            label=f"fast-forward sync to {remote}/{branch}",
        )
        outcome = "UNKNOWN"
        try:
            success, trace = self._execute_push_cmd(remote, branch)

            if success:
                verified = self._remote_matches_head(remote, branch)
                outcome = "SUCCESS" if verified is not False else "SUCCESS_UNVERIFIED"
                self._transition(State.DONE)
                self.audit_log.emit("merge.success", {
                    "target": branch,
                    "verified": bool(verified),
                })
                return str(self.current_state.value)

            lowered = trace.lower()
            if any(sig in lowered for sig in _LOCKOUT_SIGNATURES):
                ok, path, detail = self.export_patch()
                self.audit_log.emit("platform.lockout_detected", {
                    "trace": trace[:256],
                    "export_ok": ok,
                    "export": path or detail,
                })
                self._transition(State.ADMIN_LOCKOUT_SUSPEND)
                outcome = f"SUSPENDED:{path or detail}"
                return str(self.current_state.value)

            if any(sig in lowered for sig in _NOT_FAST_FORWARD):
                self.audit_log.emit("merge.rejected_non_fast_forward", {"trace": trace[:256]})

            self._transition(State.DEGRADED_RECOVERY)
            outcome = "DEGRADED"
            return str(self.current_state.value)
        finally:
            # A checkpoint must never be left open, on any path.
            self.checkpoint_store.commit(checkpoint, outcome)
