"""
Khwarizmian Swarm — Plugin System
Extensible intent handlers + policy modules.
"""

from typing import Callable, Dict, Any, List


class SwarmPlugin:
    name: str
    version: str

    def register(self, kernel: 'EthicalKernel', registry: 'IntentRegistry') -> None:
        raise NotImplementedError


class IntentRegistry:
    def __init__(self):
        self._handlers: Dict[str, Callable] = {}

    def register(self, intent: str, handler: Callable) -> None:
        self._handlers[intent] = handler

    def get(self, intent: str) -> Callable | None:
        return self._handlers.get(intent)


class PolicyEngine:
    """
    Configurable policy engine — the Al-Muqabala balancer.
    Override this to add custom governance rules.
    """

    def evaluate(self, intent: str, parameters: Any, context: Dict) -> tuple[bool, str]:
        """
        Returns (allowed, reason).
        Override in subclasses for custom policy.
        """
        return True, "DEFAULT_ALLOW"

    def preflight_check(self, agent: Any, packet: Dict) -> tuple[bool, str]:
        """
        Pre-execution guard rails.
        """
        return True, "PASS"

    def postmortem(self, agent: Any, intent: str, parameters: Any, success: bool) -> None:
        """
        Log outcome for future policy learning.
        """
        pass


class ConsensusEngine:
    """
    Liquid Democracy — agents delegate votes to trusted nodes.
    Implements Al-Muqabala: balance between speed and representation.
    """

    def __init__(self, agents: List[Any], threshold: float = 0.5):
        self.agents = agents
        self.threshold = threshold
        self.delegations: Dict[str, str] = {}
        self._votes: Dict[str, int] = {}

    def delegate(self, agent_id: str, to_agent_id: str) -> None:
        self.delegations[agent_id] = to_agent_id

    def vote(self, proposal_id: str, agent_id: str, approve: bool) -> None:
        key = f"{proposal_id}:{agent_id}"
        self._votes[key] = 1 if approve else -1

    def resolve(self, proposal_id: str) -> tuple[bool, float]:
        total_votes = 0
        weighted_approve = 0.0

        for agent in self.agents:
            aid = getattr(agent, 'agent_id', str(agent))
            vote_key = f"{proposal_id}:{aid}"

            vote = self._votes.get(vote_key, 0)

            if aid in self.delegations:
                delegate_key = f"{proposal_id}:{self.delegations[aid]}"
                vote = self._votes.get(delegate_key, 0)

            total_votes += 1
            if vote > 0:
                weighted_approve += 1.0

        score = weighted_approve / total_votes if total_votes > 0 else 0.0
        return score >= self.threshold, score
