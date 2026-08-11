"""Synchronizer: keeps a topology and a lightweight vectorized state ledger (simulated vectors).
Provides simple APIs for registering agents, updating state embeddings, and time-warp ordering.
"""

import time
import random
from typing import Dict, Any, List

class Synchronizer:
    def __init__(self):
        # topology: agent_id -> list of connected agent_ids
        self.topology: Dict[str, List[str]] = {}
        # vector ledger: agent_id -> (timestamp, vector)
        self.vector_ledger: Dict[str, Dict[str, Any]] = {}
        # logical clock per agent
        self.logical_clocks: Dict[str, int] = {}

    def register_agent(self, agent_id: str, connections: List[str] = None):
        self.topology.setdefault(agent_id, [])
        if connections:
            self.topology[agent_id] = list(set(self.topology[agent_id] + connections))
        self.logical_clocks.setdefault(agent_id, 0)

    def update_state_vector(self, agent_id: str, state_doc: str):
        # Simulate a small embedding by hashing characters -> small float vector
        vec = [((ord(c) % 10) / 10.0) for c in state_doc[:32]]
        timestamp = time.time()
        self.vector_ledger[agent_id] = {"timestamp": timestamp, "vector": vec}
        # increment logical clock
        self.logical_clocks[agent_id] = self.logical_clocks.get(agent_id, 0) + 1

    def get_agent_vector(self, agent_id: str):
        return self.vector_ledger.get(agent_id)

    def time_warp_compare(self, agent_a: str, agent_b: str) -> int:
        # returns -1 if a before b, 0 if equal, 1 if after
        ta = self.vector_ledger.get(agent_a, {}).get("timestamp", 0)
        tb = self.vector_ledger.get(agent_b, {}).get("timestamp", 0)
        if ta < tb:
            return -1
        if ta > tb:
            return 1
        return 0

