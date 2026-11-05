# ProtocolTimelock

**Status: design artifact, not compiled or deployed.** This repository has no
`solc` or `forge`, so nothing here has been compiled, fuzzed, or reviewed on a
fork. Treat `ProtocolTimelock.sol` as a specification until the suite below
passes and an independent review is done.

## Target versions

- **OpenZeppelin Contracts v5.x** (5.0 or later). v5 requires `^0.8.20`; this
  file pins `0.8.28`. Do not backport to v4: `TimelockController` changed its
  constructor and role handling, and this override set assumes v5 signatures.
- **OZ Governor v5** is the supported governance front end: the Governor holds
  `PROPOSER_ROLE`, and `EXECUTOR_ROLE` is granted to the Governor or to
  `address(0)` for open execution.
- **GovernorBravo (Compound) is NOT compatible.** It calls
  `executeTransaction(...)`, which is a different ABI. A drop-in swap will
  silently fail to execute. An adapter or a Bravo-shaped timelock is required.

## What changed from the pasted draft

| Draft | Problem | Fix here |
|---|---|---|
| `initialDelay >= 3 days ? initialDelay : 3 days` | Silently clamps a misconfigured delay into range — deployment "succeeds" with the wrong value | `_validatedDelay` reverts in the constructor |
| `execute` / `executeBatch` blocked when paused | Pause also blocks the fix during an active exploit | Safety-call allowlist: allowlisted `(target, selector)` still executes |
| `toggleEmergencyPause` | Guardian can freeze forever | `setEmergencyPause(duration)` capped at 72h, cumulative cap 7 days per incident; `clearEmergencyPause` resets |
| `updateDelay` re-applies `onlyRole` | Parent already enforces it; duplicate role check costs gas | Modifier removed |
| No pause-length error | — | `PauseTooLong` custom error |

Note: OZ already emits `MinDelayChange`; `DelayUpdated` duplicates it. Keep one.

## Security properties worth asserting in tests

- Lowering `minDelay` does **not** accelerate already-scheduled operations:
  their ETA is fixed at `schedule` time.
- After `renounceRole(TIMELOCK_ADMIN_ROLE, deployer)`, every role change
  requires a proposal that waits the current delay.
- Guardian holds `CANCELLER_ROLE`, so canceling one malicious pending op is
  faster and less blunt than pausing everything.

## Required test suite (Foundry) before any deployment

1. Constructor reverts below `MIN_DELAY` and above `MAX_DELAY`.
2. Constructor reverts on `address(0)` proposer/executor arrays if unintended.
3. `schedule` → `execute` succeeds exactly at `eta`, reverts one second before.
4. `updateDelay` reverts outside bounds; non-admin call reverts.
5. Lowering `minDelay` does not change an existing operation's `eta`.
6. Paused: `execute` reverts; allowlisted `(target, selector)` still executes.
7. Paused: `executeBatch` reverts if any call is not allowlisted.
8. Guardian pause cannot exceed 72h; cumulative pause cannot exceed 7 days.
9. `clearEmergencyPause` resets both `pauseUntil` and `pauseStartedAt`.
10. Guardian cannot call `setSafetyCall` (timelock admin only).
11. Guardian can cancel a pending operation.
12. Fuzz: `pauseUntil <= pauseStartedAt + MAX_TOTAL_PAUSE` always.

## Deployment checklist

- [ ] Confirm OZ version resolves to v5.x; pin the lockfile.
- [ ] Verify `proposers`/`executors` arrays. `address(0)` in `executors` means
      *anyone* can execute after the delay — usually fine, but make it explicit.
- [ ] Deploy with `admin = deployer`, grant roles, then
      `renounceRole(TIMELOCK_ADMIN_ROLE, deployer)` in the same transaction batch.
- [ ] Transfer ownership/admin of every controlled contract to the timelock.
- [ ] Add `setSafetyCall(protocol, protocol.pause.selector, true)` before relying
      on the pause path.
- [ ] Run the suite on a mainnet fork, not just unit tests.
