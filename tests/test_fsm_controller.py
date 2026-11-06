import unittest

from orchestrator.fsm.controller import OrchestratorFSMController, redact
from orchestrator.fsm.types import FSMError, State


class Store:
    def __init__(self):
        self.written, self.committed = [], []

    def write(self, **kwargs):
        self.written.append(kwargs)
        return "ck1"

    def commit(self, handle, outcome):
        self.committed.append((handle, outcome))


class Audit:
    def __init__(self):
        self.events = []

    def emit(self, name, payload):
        self.events.append((name, payload))


def make(git_returns, export=(True, "pending/x.patch", "10 bytes")):
    store, audit = Store(), Audit()
    controller = OrchestratorFSMController({}, store, audit)
    queue = list(git_returns)
    controller._git = lambda args: queue.pop(0) if queue else (0, "")
    controller.export_patch = lambda base="origin/main", dest_dir=None: export
    return controller, store, audit


class FSMTests(unittest.TestCase):
    def test_success_reaches_done_and_closes_checkpoint(self):
        c, store, audit = make([(0, "ok"), (0, "abc123"), (0, "abc123\trefs/heads/main")])
        self.assertEqual(c.attempt_remote_merge(), "DONE")
        self.assertEqual(store.committed, [("ck1", "SUCCESS")])

    def test_lockout_is_detected_case_insensitively(self):
        c, store, audit = make([(1, "remote: error: GH006: Protected branch update failed")])
        self.assertEqual(c.attempt_remote_merge(), "ADMIN_LOCKOUT_SUSPEND")
        self.assertIn("SUSPENDED", store.committed[-1][1])
        self.assertTrue(any(name == "platform.lockout_detected" for name, _ in audit.events))

    def test_generic_failure_degrades_and_still_closes_checkpoint(self):
        c, store, _ = make([(128, "fatal: unable to access")])
        self.assertEqual(c.attempt_remote_merge(), "DEGRADED_RECOVERY")
        self.assertEqual(store.committed[-1][1], "DEGRADED")

    def test_resume_from_suspend_completes(self):
        c, _, _ = make([(1, "Protected branch"), (0, "ok"), (0, "h"), (0, "h\trefs/heads/main")])
        c.attempt_remote_merge()
        self.assertEqual(c.current_state, State.ADMIN_LOCKOUT_SUSPEND)
        self.assertEqual(c.attempt_remote_merge(), "DONE")

    def test_done_is_terminal(self):
        c, _, _ = make([])
        c.current_state = State.DONE
        with self.assertRaises(FSMError):
            c.resume()

    def test_unsafe_branch_is_rejected_before_git_runs(self):
        c, _, _ = make([])
        with self.assertRaises(FSMError):
            c._execute_push_cmd("origin", "a;b")

    def test_remote_cannot_smuggle_an_option(self):
        c, _, _ = make([])
        with self.assertRaises(FSMError):
            c._execute_push_cmd("--upload-pack=evil", "main")

    def test_redaction_removes_url_and_token_credentials(self):
        out = redact("https://x-access-token:shpat_abc123@github.com/a/b")
        self.assertNotIn("abc123", out)
        self.assertIn("<redacted>@", out)


if __name__ == "__main__":
    unittest.main()
