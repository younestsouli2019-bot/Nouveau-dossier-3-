"""
Redlock engine smoke test (no network required — uses a fake Redis).

Run:
    python -m pytest src/locking/tests/test_distlock.py -xvs
    # plain:  python src/locking/tests/test_distlock.py
"""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.locking.distlock import (  # noqa: E402
    LockAcquisition,
    QuorumNotReached,
    RedlockEngine,
    StateCollision,
    from_urls,
)


class FakeRedis:
    """Minimal Redis stand-in — implements only the subset distlock uses.

    Each FakeRedis instance is an independent "replica"; callers create
    three separate instances to simulate failure domains.
    """

    def __init__(self, tag: str, fail_rate: float = 0.0) -> None:
        self.tag = tag
        self.fail_rate = fail_rate
        self._data: dict[str, tuple[str, float]] = {}  # key -> (value, expires_monotonic)
        self._scripts: dict[str, str] = {}
        self._script_id = 0

    # ---------------- public subset used by distlock ----------------
    def set(self, key: str, value: str, nx: bool = False, px: int = 0) -> Optional[bool]:
        self._roll_expired()
        import random
        if random.random() < self.fail_rate:
            raise ConnectionError(f"{self.tag} simulated fail")
        if nx and key in self._data:
            return False
        self._data[key] = (value, time.monotonic() + px / 1000)
        return True

    def eval(self, script: str, numkeys: int, *args: Any) -> Any:
        # Inline interpreter for the two tiny Lua scripts we use.
        keys = list(args[:numkeys])
        argv = list(args[numkeys:])
        assert numkeys == 1
        if "if redis.call('GET', KEYS[1]) == ARGV[1] then" in script:
            if "return redis.call('DEL', KEYS[1])" in script:
                if self._data.get(keys[0], ("", 0))[0] == argv[0]:
                    self._data.pop(keys[0], None)
                    return 1
                return 0
            if "return redis.call('PEXPIRE', KEYS[1], ARGV[2])" in script:
                if self._data.get(keys[0], ("", 0))[0] == argv[0]:
                    ttl_ms = int(argv[1])
                    _, _old = self._data[keys[0]]
                    self._data[keys[0]] = (argv[0], time.monotonic() + ttl_ms / 1000)
                    return 1
                return 0
        raise RuntimeError("unknown lua script")

    # ------------- plumbing ------------------------------------------------
    def _roll_expired(self) -> None:
        now = time.monotonic()
        self._data = {k: v for k, v in self._data.items() if v[1] > now}


def build_engine(n: int = 3, fail_rates: Optional[list[float]] = None) -> tuple[RedlockEngine, list[FakeRedis]]:
    fakes = [FakeRedis(f"r{i}", fail_rates[i] if fail_rates else 0.0) for i in range(n)]
    return RedlockEngine(fakes, name=f"test-{n}"), fakes


def test_quorum_acquire_release_owner_only() -> None:
    engine, fakes = build_engine(3)
    acq = engine.lock("foo")
    assert acq.valid
    assert acq.locked_nodes >= 2
    # A second identity CANNOT steal the lock (still held).
    thief = RedlockEngine(fakes)
    try:
        thief.try_lock("foo", ttl_ms=10_000)
    except QuorumNotReached:
        pass
    else:  # pragma: no cover
        raise AssertionError("thief took a live lock")
    # unlock
    engine.unlock(acq)
    assert acq.released
    # now thief succeeds
    acq2 = thief.try_lock("foo")
    assert acq2.valid
    # first unlocker cannot remove thief's lock (CAS-owner check)
    engine.unlock(acq)  # no-op, acq was already released — also non-owner
    # assert thief's lock still there
    for f in fakes:
        if acq2.identity in [v[0] for v in f._data.values()]:
            break
    else:  # pragma: no cover
        raise AssertionError("thief's identity disappeared after non-owner unlock")
    print("✓ test_quorum_acquire_release_owner_only")


def test_state_collision_anti_cannibal() -> None:
    engine, _ = build_engine(3)
    state = RedlockEngine.state_hash(["150.00", "Payoneer", "younestsouli2019@gmail.com", "20260820T14"])
    with engine("x", state_sha256=state):
        try:
            engine.try_lock("x", state_sha256=state)
        except StateCollision:
            pass
        else:  # pragma: no cover
            raise AssertionError("duplicate state hash should have raised StateCollision")
    # After expiry-window should re-trigger — test by poisoning the cache with the past
    engine._replays[state] = 0  # force-expire
    acq = engine.try_lock("y", state_sha256=state)
    assert acq.valid
    engine.unlock(acq)
    print("✓ test_state_collision_anti_cannibal")


def test_extend_heartbeater_path() -> None:
    engine, fakes = build_engine(3)
    acq = engine.try_lock("beat", ttl_ms=300)
    assert acq.valid
    # sleep past TTL; heartbeater would have extended 3 times in 250 ms cadence
    time.sleep(0.9)
    # identity should still be on at least 2 nodes
    found = 0
    for f in fakes:
        for _, (ident, expires) in list(f._data.items()):
            if ident == acq.identity and expires > time.monotonic():
                found += 1
    assert found >= 2, f"heartbeater failed: found on {found}/3 nodes"
    engine.unlock(acq)
    print("✓ test_extend_heartbeater_path")


def test_majority_down_raises() -> None:
    # two of three replicas fail 100% of the time → cannot reach quorum=2
    engine, _ = build_engine(3, fail_rates=[1.0, 1.0, 0.0])
    try:
        engine.lock("z", timeout_s=0.2)
    except Exception:
        pass
    else:  # pragma: no cover
        raise AssertionError("quorum-unreachable should fail")
    print("✓ test_majority_down_raises")


def test_context_manager_single_writer_pattern() -> None:
    engine, _ = build_engine(3)
    seen: list[int] = []
    errors: list[str] = []

    def worker(i: int) -> None:
        state = RedlockEngine.state_hash(["resource", "singleton-writer"])
        try:
            with engine(f"bar-{i % 2}", timeout_s=1.5, state_sha256=state if i % 2 == 0 else None):
                seen.append(i)
                # minimal CS
                time.sleep(0.01)
        except StateCollision:
            errors.append("collision")
        except Exception as e:  # pragma: no cover
            errors.append(str(e))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # even workers compete for the same state_sha256 — only 1 can pass; others fail StateCollision
    assert "collision" in errors or len([x for x in seen if x % 2 == 0]) == 1
    print("✓ test_context_manager_single_writer_pattern  seen=", seen, "collisions=", errors.count("collision"))


if __name__ == "__main__":
    test_quorum_acquire_release_owner_only()
    test_state_collision_anti_cannibal()
    test_extend_heartbeater_path()
    test_majority_down_raises()
    test_context_manager_single_writer_pattern()
    print("\nALL distlock tests PASSED")
