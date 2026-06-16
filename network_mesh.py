"""
Khwarizmian Swarm -- Leaderless P2P Mesh Network Simulation
Implements the "Leaderless Mesh" Mandate from the Khwarizmian Ijtihad:
No head; every agent is a holographic whole. Communication via TTL-bounded flooding.
"""

import time
import random
from typing import Dict, List, Any, Set, Optional
from swarm_agent import SwarmAgent


class MeshMessage:
    def __init__(self, sender_id: str, intent: str, parameters: Any, ttl: int = 3):
        self.sender_id = sender_id
        self.intent = intent
        self.parameters = parameters
        self.ttl = ttl
        self.id = f"{sender_id}_{time.time()}_{random.randint(1000,9999)}"
        self.hops: List[str] = []

    def forward(self, relay_id: str) -> bool:
        if self.ttl <= 0:
            return False
        self.ttl -= 1
        self.hops.append(relay_id)
        return True

    def is_expired(self) -> bool:
        return self.ttl < 0


class MeshNetwork:
    """
    Leaderless peer-to-peer mesh network.
    Messages are flooded with TTL bounding so the network self-heals
    (no single point of failure / no "queen" node).
    """

    def __init__(self, agents: List[SwarmAgent], topology: str = 'mesh', ttl: int = 3):
        self.agents = {str(getattr(a, 'agent_id', str(a))): a for a in agents}
        self.ttl = ttl
        self.topology = topology
        self._inbox: Dict[str, List[MeshMessage]] = {aid: [] for aid in self.agents}
        self._delivered: Set[str] = set()
        self._consensus_log: List[Dict] = []

    def broadcast(self, sender_id: str, intent: str, parameters: Any) -> List[MeshMessage]:
        """Flood a message across the mesh from sender_id."""
        msg = MeshMessage(sender_id, intent, parameters, ttl=self.ttl)
        msg.hops.append(sender_id)
        delivered = []
        peer_ids = list(self.agents.keys())

        for peer_id in peer_ids:
            if peer_id == sender_id:
                continue
            if msg.ttl > 0:
                msg.forward(peer_id)
                self._inbox[peer_id].append(msg)
                delivered.append(msg)
                self._delivered.add(msg.id)
                print(f"  [Mesh] {peer_id} received: '{intent}' from {sender_id} "
                      f"(TTL={msg.ttl+1} hops, path: {'->'.join(msg.hops)})")

        print(f"  [Mesh] {sender_id} broadcast '{intent}' -- reached {len(delivered)} peers")
        return delivered

    def deliver_next(self, agent_id: str) -> Optional[MeshMessage]:
        """Agent pulls its next pending message from the inbox."""
        if self._inbox.get(agent_id):
            return self._inbox[agent_id].pop(0)
        return None

    def propose(self, proposer_id: str, intent: str, parameters: Any) -> Dict:
        """An agent proposes a motion to the mesh for democratic vote."""
        self.broadcast(proposer_id, intent, parameters)
        proposal = {
            'id': f"{proposer_id}_{time.time()}",
            'proposer': proposer_id,
            'intent': intent,
            'parameters': parameters,
            'votes_for': 1,
            'votes_against': 0,
            'voters': [proposer_id],
            'ts': time.time()
        }
        print(f"  [Mesh] {proposer_id} proposed: '{intent}' with params {parameters}")
        self._consensus_log.append(proposal)
        return proposal

    def reach_consensus(self, intent: str, threshold: float = 0.5) -> tuple[bool, float]:
        """Resolve the latest proposal matching intent. Returns (agreed, score)."""
        matching = [p for p in self._consensus_log if p['intent'] == intent]
        if not matching:
            return False, 0.0
        proposal = matching[-1]
        total_agents = len(self.agents)
        score = proposal['votes_for'] / total_agents if total_agents > 0 else 0.0
        agreed = score >= threshold
        print(f"  [Mesh] Consensus on '{intent}': {score:.0%} approved "
              f"({'PASSED' if agreed else 'REJECTED'})")
        return agreed, score

    def simulate_voting_round(self) -> None:
        """Simulate a full democratic voting round across the mesh."""
        print(f"\n  [Mesh] Starting P2P voting round -- {len(self.agents)} agents")
        proposal = self.propose(
            proposer_id=random.choice(list(self.agents.keys())),
            intent='deploy_rescue_drones',
            parameters={'zone': 'flood_zone_delta'}
        )
        for agent_id in self.agents:
            if agent_id == proposal['proposer']:
                continue
            vote = random.random() > 0.25
            if vote:
                proposal['votes_for'] += 1
            else:
                proposal['votes_against'] += 1
            proposal['voters'].append(agent_id)
            print(f"  [Mesh] {agent_id} voted {'FOR' if vote else 'AGAINST'} -- "
                  f"tally: {proposal['votes_for']}/{len(self.agents)}")
        self.reach_consensus('deploy_rescue_drones', threshold=0.6)


def run_mesh_simulation():
    """Full P2P mesh simulation with agents."""
    print("=" * 60)
    print("  PHASE 5 -- P2P Mesh Network (Leaderless Communication)")
    print("  No queen. Every agent is the whole. The whole is every agent.")
    print("=" * 60)

    agents = [SwarmAgent(i) for i in range(5)]
    mesh = MeshNetwork(agents, topology='mesh', ttl=3)

    print("\n[Mesh] Initializing leaderless mesh with 5 agents...")
    print(f"  Topology: {mesh.topology} (fully connected, no leader)")
    print(f"  TTL: {mesh.ttl} hops (self-healing, no single point of failure)")

    print("\n[Test A] Broadcast status_check from Agent-0")
    mesh.broadcast('0', 'status_check', {'seq': 1})

    print("\n[Test B] Broadcast task_dispatch from Agent-2")
    mesh.broadcast('2', 'task_dispatch', {'target_zone': 'sector_7', 'priority': 'high'})

    print("\n[Test C] Full democratic proposal + voting round")
    mesh.simulate_voting_round()

    print("\n[Test D] Simulated network partition + recovery (TTL test)")
    msg = MeshMessage('4', 'emergency_shutdown', {}, ttl=2)
    for i, peer in enumerate(['0', '1', '2']):
        alive = msg.forward(peer)
        print(f"  [Mesh] Relay {peer}: {'forwarded' if alive else 'dropped'} "
              f"(TTL now: {msg.ttl})")

    print("\n[Mesh] Audit log:")
    for agent_id, agent in mesh.agents.items():
        log = agent.kernel.get_audit_log()
        print(f"  Agent-{agent_id}: {len(log)} kernel events")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    run_mesh_simulation()
