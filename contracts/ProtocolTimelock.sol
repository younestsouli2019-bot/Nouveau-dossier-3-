// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ProtocolTimelock
 * @notice OpenZeppelin v5 TimelockController with:
 *         - fail-closed delay bounds (no silent clamping)
 *         - time-limited emergency pause with a hard cumulative cap
 *         - safety-call allowlist so remediation is never blocked by the pause
 *
 * STATUS: NOT DEPLOYED, NOT COMPILED HERE. This repository has no solc/forge.
 * Do not deploy before the test suite in contracts/README.md passes.
 */
contract ProtocolTimelock is TimelockController {
    uint256 public constant MIN_DELAY = 3 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant MAX_PAUSE = 72 hours;
    uint256 public constant MAX_TOTAL_PAUSE = 7 days;

    error DelayOutOfBounds(uint256 requested, uint256 min, uint256 max);
    error PauseTooLong(uint256 requestedUntil, uint256 cap);
    error EmergencyPaused();
    error Unauthorized();

    /// @notice Executions are restricted while block.timestamp < pauseUntil.
    uint256 public pauseUntil;
    /// @notice Start of the current incident; bounds cumulative pause time.
    uint256 public pauseStartedAt;

    /// @notice target => selector allowed to execute while paused.
    mapping(address => mapping(bytes4 => bool)) public safetyCall;

    event EmergencyPauseSet(uint256 until);
    event SafetyCallSet(address indexed target, bytes4 indexed selector, bool allowed);
    event DelayUpdated(uint256 oldDelay, uint256 newDelay);

    constructor(
        uint256 initialDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin,
        address guardian
    ) TimelockController(_validatedDelay(initialDelay), proposers, executors, admin) {
        if (guardian != address(0)) {
            _grantRole(CANCELLER_ROLE, guardian);
        }
    }

    function _validatedDelay(uint256 delay) private pure returns (uint256) {
        if (delay < MIN_DELAY || delay > MAX_DELAY) {
            revert DelayOutOfBounds(delay, MIN_DELAY, MAX_DELAY);
        }
        return delay;
    }

    /**
     * @notice Freeze executions for `duration`, capped per incident.
     * @dev Guardian cannot lock the protocol permanently: cumulative pause is
     *      bounded by MAX_TOTAL_PAUSE; extending beyond requires governance.
     */
    function setEmergencyPause(uint256 duration) external {
        if (!hasRole(CANCELLER_ROLE, msg.sender)) revert Unauthorized();
        if (duration == 0 || duration > MAX_PAUSE) revert PauseTooLong(duration, MAX_PAUSE);

        uint256 start = pauseStartedAt == 0 ? block.timestamp : pauseStartedAt;
        uint256 until = block.timestamp + duration;
        if (until > start + MAX_TOTAL_PAUSE) revert PauseTooLong(until, start + MAX_TOTAL_PAUSE);

        pauseStartedAt = start;
        pauseUntil = until;
        emit EmergencyPauseSet(until);
    }

    function clearEmergencyPause() external {
        if (!hasRole(CANCELLER_ROLE, msg.sender)) revert Unauthorized();
        pauseUntil = 0;
        pauseStartedAt = 0;
        emit EmergencyPauseSet(0);
    }

    function isPaused() public view returns (bool) {
        return block.timestamp < pauseUntil;
    }

    /// @notice Allowlist a call (e.g. pause()) that must work during an emergency.
    function setSafetyCall(address target, bytes4 selector, bool allowed)
        external
        onlyRole(TIMELOCK_ADMIN_ROLE)
    {
        safetyCall[target][selector] = allowed;
        emit SafetyCallSet(target, selector, allowed);
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata payload,
        bytes32 predecessor,
        bytes32 salt
    ) public payable override {
        if (isPaused() && !_isSafetyCall(target, payload)) revert EmergencyPaused();
        super.execute(target, value, payload, predecessor, salt);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt
    ) public payable override {
        if (isPaused()) {
            for (uint256 i = 0; i < targets.length; ++i) {
                if (!_isSafetyCall(targets[i], payloads[i])) revert EmergencyPaused();
            }
        }
        super.executeBatch(targets, values, payloads, predecessor, salt);
    }

    function _isSafetyCall(address target, bytes calldata payload) private view returns (bool) {
        if (payload.length < 4) return false;
        bytes4 selector;
        assembly {
            selector := calldataload(payload.offset)
        }
        return safetyCall[target][selector];
    }

    /// @dev Parent already enforces onlyRole(TIMELOCK_ADMIN_ROLE); no duplicate check.
    function updateDelay(uint256 newDelay) public override {
        if (newDelay < MIN_DELAY || newDelay > MAX_DELAY) {
            revert DelayOutOfBounds(newDelay, MIN_DELAY, MAX_DELAY);
        }
        uint256 oldDelay = getMinDelay();
        super.updateDelay(newDelay);
        emit DelayUpdated(oldDelay, newDelay);
    }
}
