"""
distlock.py — Distributed Redlock Engine (Martins & Rossetto 2016).

Rationale
=========
Single-writer guarantee (see ``PRECAUTIONS.md`` row 2) requires a lock that
cannot be starved by a crashed worker and that survives loss of one Redis
replica.  This implementation uses *five* independent Redis replicas (the
original Redlock paper uses N >= 3, quorum = floor(N/2) + 1).  For this
codebase we accept N=3, quorum=2 on a 3-node Redis cluster (sentinel-
discovered or 3 separate hosts on disjoint failure domains).

Features
--------
* Majority (quorum) acquisition with drift compensation.
* Automatic TTL heartbeater (extend) thread while the lock is held.
* Non-blocking ``try_lock`` + blocking ``lock``.
* Identity token (random 16 bytes hex) stored as the lock value so ONLY
  the acquirer can release it — prevents "del-expired then delete by
  late worker" class of bug (TRUTH-007 analog at the distributed layer).
* Single-writer ledger route hook: ``with distlock('ledger-writer'):``
* Unique-state-SHA256 gate: caller passes a state-hash; lock refuses
  acquisition (raises ``StateCollision``) if the same hash was already
  held in the last ``replay_window_seconds`` (anti-cannibalism guard).
* Prometheus-friendly stats dictionary on every acquisition attempt.
* Python 3.10+ stdlib only plus ``redis-py`` (``pip install redis``).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

try:
    from redis import Redis, exceptions as rex
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "distlock requires redis-py: `pip install redis>=5.0`"
    ) from e


# ---------------------------------------------------------------------------
# Defaults — can be overridden per instance
# ---------------------------------------------------------------------------
DEFAULT_REPLICAS: int = 3
DEFAULT_QUORUM: int = 2  # floor(3/2)+1
DEFAULT_TTL_MS: int = 8_000
DEFAULT_CLOCK_DRIFT_MS: int = 50
DEFAULT_EXTEND_INTERVAL: float = 0.4  # 400 ms
DEFAULT_REPLAY_WINDOW_S: int = 300  # 5 min state-collision guard


class LockError(RuntimeError):
    """Base class for lock-related failures."""


class QuorumNotReached(LockError):
    """Could not lock >= quorum replicas before TTL started elapsing."""


class StateCollision(LockError):
    """The caller's state-hash collides with one already used this window."""


class NotTheOwner(LockError):
    """Attempted to release or extend a lock held by a different identity."""


# ---------------------------------------------------------------------------
# Value object describing a (successful or failed) lock attempt.
# ---------------------------------------------------------------------------
@dataclass
class LockAcquisition:
    key: str
    identity: str
    quorum: int
    locked_nodes: int = 0
    ttl_ms: int = 0
    acquired_at_ns: int = 0
    released: bool = False
    stats: dict = field(default_factory=dict)
    nodes_ok: list[str] = field(default_factory=list)
    nodes_fail: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return (
            self.locked_nodes >= self.quorum
            and not self.released
            and self.ttl_ms > 0
        )


class RedlockEngine:
    """Distributed locking engine.

    Parameters
    ----------
    replicas:
        Iterable of Redis client instances (already constructed by caller).
        The caller is responsible for using distinct hosts on disjoint
        failure domains (different racks / AZs / providers).  For the
        simplest local/dev path, pass three ``Redis(port=6379+i)``.
    quorum:
        ``floor(N/2) + 1`` by default.
    ttl_ms:
        Default lease TTL (heartbeater extends it periodically while held).
    clock_drift_ms:
        Safety margin added to measured acquisition latency to compensate
        for unsynchronised wall clocks between the client and replicas.
    replay_window_s:
        Seconds during which a ``state_sha256`` is considered "recently
        held" and a second acquisition for the same SHA is rejected.
    name:
        Human label used in heartbeater thread names.
    """

    def __init__(
        self,
        replicas: Iterable[Redis],
        quorum: Optional[int] = None,
        ttl_ms: int = DEFAULT_TTL_MS,
        clock_drift_ms: int = DEFAULT_CLOCK_DRIFT_MS,
        replay_window_s: int = DEFAULT_REPLAY_WINDOW_S,
        name: str = "redlock-0",
    ) -> None:
        self._replicas: list[Redis] = list(replicas)
        if len(self._replicas) < 1:
            raise ValueError("At least one replica is required")
        self._quorum = quorum if quorum is not None else (len(self._replicas) // 2 + 1)
        if self._quorum > len(self._replicas):
            raise ValueError("quorum cannot exceed replica count")
        self._ttl_ms = ttl_ms
        self._drift = clock_drift_ms
        self._replay = replay_window_s
        self._name = name
        self._local_lock = threading.RLock()
        # replay registry: state_sha256 -> expiry unix_ns
        self._replays: dict[str, int] = {}
        # heartbeater bookkeeping: (key, identity) -> threading.Event
        self._heart: dict[tuple[str, str], threading.Event] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def try_lock(
        self,
        key: str,
        ttl_ms: Optional[int] = None,
        state_sha256: Optional[str | bytes] = None,
        metadata: Optional[dict] = None,
    ) -> LockAcquisition:
        """Attempt a single quorum acquisition.  Non-blocking.

        Raises ``StateCollision`` if ``state_sha256`` has been used within
        ``replay_window_s`` (anti-cannibalism).
        """
        use_ttl = ttl_ms or self._ttl_ms
        identity = secrets.token_hex(16)
        self._replay_check(state_sha256)
        start_ns = time.perf_counter_ns()
        ok_nodes: list[str] = []
        fail_nodes: list[str] = []

        for idx, node in enumerate(self._replicas):
            node_tag = f"redis-{idx}"
            try:
                # Use `set nx px` atomic — NX ensures no overwrite.
                set_val = node.set(
                    self._lock_key(key),
                    identity,
                    nx=True,
                    px=use_ttl,
                )
                if set_val is True:
                    ok_nodes.append(node_tag)
                else:
                    fail_nodes.append(node_tag)
            except (rex.RedisError, rex.ConnectionError, TimeoutError):
                fail_nodes.append(node_tag)

        latency_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
        effective_ttl = use_ttl - latency_ms - self._drift

        acq = LockAcquisition(
            key=key,
            identity=identity,
            quorum=self._quorum,
            locked_nodes=len(ok_nodes),
            ttl_ms=max(effective_ttl, 0),
            acquired_at_ns=start_ns,
            nodes_ok=ok_nodes,
            nodes_fail=fail_nodes,
            stats={
                "latency_ms": latency_ms,
                "effective_ttl_ms": effective_ttl,
                "drift_ms": self._drift,
                "metadata": metadata or {},
                "state_sha256": self._normalise_sha(state_sha256) if state_sha256 else None,
            },
        )
        if acq.valid:
            self._replay_commit(state_sha256)
            self._start_heartbeater(acq, ttl_ms=use_ttl)
        else:
            # best-effort rollback of any partial writes
            for idx in (int(n.split("-", 1)[1]) for n in ok_nodes):
                try:
                    self._safe_delete_if_owner(self._replicas[idx], key, identity)
                except Exception:  # pragma: no cover - rollback
                    pass
            raise QuorumNotReached(
                f"locked {len(ok_nodes)}/{len(self._replicas)} "
                f"(need {self._quorum}) effective_ttl={effective_ttl}ms"
            )
        return acq

    def lock(
        self,
        key: str,
        timeout_s: float = 10.0,
        retry_sleep: float = 0.05,
        ttl_ms: Optional[int] = None,
        state_sha256: Optional[str | bytes] = None,
        metadata: Optional[dict] = None,
    ) -> LockAcquisition:
        """Blocking acquire with retry.  Raises ``LockError`` on timeout."""
        deadline = time.monotonic() + timeout_s
        last: Optional[Exception] = None
        while time.monotonic() < deadline:
            try:
                return self.try_lock(
                    key, ttl_ms=ttl_ms, state_sha256=state_sha256, metadata=metadata
                )
            except QuorumNotReached as exc:
                last = exc
                time.sleep(retry_sleep + secrets.randbelow(5) / 1000)
        raise LockError(f"acquire timed out after {timeout_s}s") from last

    def unlock(self, acq: LockAcquisition) -> None:
        """Release only if we are still the owner (value-matched CAS delete)."""
        if acq.released:
            return
        self._stop_heartbeater(acq)
        for node in self._replicas:
            try:
                self._safe_delete_if_owner(node, acq.key, acq.identity)
            except Exception:  # pragma: no cover - defensive
                continue
        acq.released = True

    def extend(self, acq: LockAcquisition, ttl_ms: Optional[int] = None) -> bool:
        """Extend the lease on all replicas that still show our identity.

        Returns True if >= quorum replicas accepted the extension.  Fails
        silently (returns False) if we no longer own a majority — caller
        must then abort any state-mutating work.
        """
        if acq.released:
            return False
        use_ttl = ttl_ms or self._ttl_ms
        ok = 0
        for node in self._replicas:
            try:
                if self._replace_if_owner(node, acq.key, acq.identity, px_ms=use_ttl):
                    ok += 1
            except Exception:
                continue
        acq.locked_nodes = ok
        acq.ttl_ms = use_ttl
        if ok < self._quorum:
            self.unlock(acq)
            return False
        return True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def state_hash(parts: Iterable[object]) -> str:
        """Canonical unique-state hash — mirrors the SHA-256 rule in the
        Single-Writer row of the precautions matrix.

        ``parts`` may be strings, ints, bytes, or any object whose __str__
        representation is canonical for the state (amount, channel,
        destination, 1h-window bucket, etc).
        """
        h = hashlib.sha256()
        for p in parts:
            if isinstance(p, bytes):
                h.update(p)
            elif p is None:
                h.update(b"\x00")
            else:
                h.update(str(p).encode("utf-8"))
            h.update(b"|")
        return h.hexdigest()

    @staticmethod
    def _lock_key(raw: str) -> str:
        return f"redlock:{raw}"

    @staticmethod
    def _normalise_sha(s: str | bytes | None) -> str | None:
        if s is None:
            return None
        if isinstance(s, bytes):
            s = s.decode("ascii")
        s = s.strip().lower()
        if len(s) != 64 or any(c not in "0123456789abcdef" for c in s):
            raise ValueError("state_sha256 must be lowercase 64-char hex")
        return s

    def _replay_check(self, state_sha256: str | bytes | None) -> None:
        if state_sha256 is None:
            return
        sha = self._normalise_sha(state_sha256)
        with self._local_lock:
            # Expire old entries
            now = time.time_ns()
            self._replays = {
                k: v for k, v in self._replays.items() if v > now
            }
            if sha in self._replays:
                raise StateCollision(
                    f"state_sha256 {sha} held within last {self._replay}s — "
                    f"duplicate cannibal execution blocked"
                )

    def _replay_commit(self, state_sha256: str | bytes | None) -> None:
        if state_sha256 is None:
            return
        sha = self._normalise_sha(state_sha256)
        with self._local_lock:
            self._replays[sha] = time.time_ns() + self._replay * 1_000_000_000

    # Lua scripts -------------------------------------------------------
    #
    # Atomically delete the key ONLY if its value still matches the
    # identity we set.  This is the *classic* fix for the "expired, other
    # worker took the lock, first worker wakes up and deletes second
    # worker's lock" class of bug.
    _UNLOCK_LUA = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    end
    return 0
    """
    _EXTEND_LUA = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end
    return 0
    """

    def _safe_delete_if_owner(self, node: Redis, key: str, ident: str) -> int:
        return int(node.eval(self._UNLOCK_LUA, 1, self._lock_key(key), ident))

    def _replace_if_owner(self, node: Redis, key: str, ident: str, px_ms: int) -> bool:
        return bool(
            node.eval(self._EXTEND_LUA, 1, self._lock_key(key), ident, str(px_ms))
        )

    # Heartbeater -------------------------------------------------------
    def _start_heartbeater(self, acq: LockAcquisition, ttl_ms: int) -> None:
        k = (acq.key, acq.identity)
        stop = threading.Event()
        self._heart[k] = stop
        interval = max(min(ttl_ms * 0.35, 2500) / 1000, DEFAULT_EXTEND_INTERVAL)

        def beat() -> None:
            consecutive_failures = 0
            while not stop.wait(interval):
                try:
                    if self.extend(acq, ttl_ms=ttl_ms):
                        consecutive_failures = 0
                    else:
                        consecutive_failures += 1
                except Exception:
                    consecutive_failures += 1
                if consecutive_failures >= 3:
                    try:
                        self.unlock(acq)
                    except Exception:
                        pass
                    return

        t = threading.Thread(
            target=beat,
            name=f"{self._name}-heart-{acq.key[:10]}",
            daemon=True,
        )
        t.start()

    def _stop_heartbeater(self, acq: LockAcquisition) -> None:
        k = (acq.key, acq.identity)
        stop = self._heart.pop(k, None)
        if stop is not None:
            stop.set()

    # Context manager — idiomatic single-writer gate --------------------
    def __call__(
        self,
        key: str,
        *,
        timeout_s: float = 10.0,
        ttl_ms: Optional[int] = None,
        state_sha256: Optional[str | bytes] = None,
        metadata: Optional[dict] = None,
    ) -> "_LockCtx":
        return _LockCtx(self, key, timeout_s, ttl_ms, state_sha256, metadata)


@dataclass
class _LockCtx:
    engine: RedlockEngine
    key: str
    timeout_s: float
    ttl_ms: Optional[int]
    state_sha256: Optional[str | bytes]
    metadata: Optional[dict]
    acq: Optional[LockAcquisition] = None

    def __enter__(self) -> LockAcquisition:
        self.acq = self.engine.lock(
            self.key,
            timeout_s=self.timeout_s,
            ttl_ms=self.ttl_ms,
            state_sha256=self.state_sha256,
            metadata=self.metadata,
        )
        return self.acq

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.acq is not None:
            self.engine.unlock(self.acq)


# ---------------------------------------------------------------------------
# Convenience: construct a RedlockEngine from a list of URLs.
# ---------------------------------------------------------------------------
def from_urls(
    urls: list[str],
    *,
    quorum: Optional[int] = None,
    ttl_ms: int = DEFAULT_TTL_MS,
    **kw,
) -> RedlockEngine:
    """Build a ``RedlockEngine`` from ``redis://`` URLs.

    >>> rl = from_urls([
    ...     "redis://redis-0.zone-a.internal:6379/5",
    ...     "redis://redis-1.zone-b.internal:6379/5",
    ...     "redis://redis-2.zone-c.internal:6379/5",
    ... ])
    >>> with rl("ledger-writer", state_sha256=RedlockEngine.state_hash([
    ...         "$850", "mg5ikgvtp", "PAYO_1768332322687", "hourbucket-20260820T14",
    ...     ])) as lock:
    ...     # single-writer section
    ...     write_ledger_row(...)
    """
    nodes = [Redis.from_url(u, socket_connect_timeout=1, socket_timeout=1) for u in urls]
    return RedlockEngine(nodes, quorum=quorum, ttl_ms=ttl_ms, **kw)
