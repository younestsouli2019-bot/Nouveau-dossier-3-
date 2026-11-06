"""FSM vocabulary for the repository merge controller."""
from __future__ import annotations

from enum import Enum


class State(str, Enum):
    MERGING = "MERGING"
    DONE = "DONE"
    ADMIN_LOCKOUT_SUSPEND = "ADMIN_LOCKOUT_SUSPEND"
    DEGRADED_RECOVERY = "DEGRADED_RECOVERY"


# Explicit transition table: suspend and degraded states must be resumable,
# otherwise a single platform rejection ends the run permanently.
TRANSITIONS: dict[State, set[State]] = {
    State.MERGING: {State.DONE, State.ADMIN_LOCKOUT_SUSPEND, State.DEGRADED_RECOVERY},
    State.ADMIN_LOCKOUT_SUSPEND: {State.MERGING},
    State.DEGRADED_RECOVERY: {State.MERGING},
    State.DONE: set(),
}


class Outcome(str, Enum):
    SUCCESS = "SUCCESS"
    LOCKOUT = "LOCKOUT"
    DEGRADED = "DEGRADED"


class FSMError(RuntimeError):
    """Raised on an illegal state transition."""
