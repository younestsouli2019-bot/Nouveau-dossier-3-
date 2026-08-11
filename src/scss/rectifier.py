"""Rectifier layer: drift detection, meta-prompt governor, and runtime injection.
This module simulates detection of repeat failures and applies corrective prompts.
"""

from typing import Dict, Any

class DriftDetector:
    def __init__(self, fail_threshold: int = 2):
        self.fail_threshold = fail_threshold

    def is_drift(self, telemetry: Dict[str, Any]) -> bool:
        # simple policy: if fail_count >= threshold or last_output contains 'unparseable'
        last = telemetry.get("last_output") or {}
        if telemetry.get("fail_count", 0) >= self.fail_threshold:
            return True
        if isinstance(last, dict) and last.get("error") == "unparseable_payload":
            return True
        return False

class MetaPromptGovernor:
    def __init__(self):
        pass

    def generate_correction(self, agent_id: str, telemetry: Dict[str, Any]) -> str:
        # In a real system, this would call a supervising LLM to produce a correction vector.
        # Here we simulate by returning a deterministic instruction based on the error.
        last = telemetry.get("last_output") or {}
        if isinstance(last, dict) and last.get("error") == "unparseable_payload":
            return "IF payload parsing fails, bypass negotiation and route directly to Agent: Data_Fixer. CLEAR_LAST_CONTEXT"
        # fallback generic correction
        return "ENFORCE_STRICT_PARSING; REDUCE_RESPONSE_VERBOSITY"

class Rectifier:
    def __init__(self, detector: DriftDetector, governor: MetaPromptGovernor):
        self.detector = detector
        self.governor = governor

    def inspect_and_patch(self, agent, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        if not self.detector.is_drift(telemetry):
            return {"patched": False}
        correction = self.governor.generate_correction(agent.id, telemetry)
        # apply special token CLEAR_LAST_CONTEXT
        if "CLEAR_LAST_CONTEXT" in correction:
            agent.local_context = []
        # inject prompt (hot patch)
        agent.inject_prompt(f"{agent.prompt} || HOT_PATCH: {correction}")
        # close circuit to allow operator to re-init
        agent.open_circuit()
        return {"patched": True, "correction": correction}
