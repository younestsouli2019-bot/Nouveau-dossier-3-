"""Agent abstraction: holds a prompt, local context, state and a small run() that processes inputs.
Simulates behavior; drift is simulated by returning a specific marker for failure.
"""

import asyncio
import random
from typing import Dict, Any, Optional

class Agent:
    def __init__(self, agent_id: str, prompt: str, bus=None):
        self.id = agent_id
        self.prompt = prompt
        self.local_context = []
        self.state: Dict[str, Any] = {"status": "idle", "last_output": None}
        self.bus = bus
        self._circuit_open = False
        self._fail_count = 0

    async def process(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self._circuit_open:
            return {"status": "circuit_open", "agent": self.id}

        # Simulate processing time
        await asyncio.sleep(random.random() * 0.2)

        # Simulate a failure condition when payload contains 'corrupt'
        if payload.get("corrupt"):
            self._fail_count += 1
            output = {"error": "unparseable_payload", "raw": payload}
            self.state["last_output"] = output
            return output

        # Normal operation -- respond using prompt
        response = {"result": f"processed by {self.id}", "prompt": self.prompt}
        self.state["last_output"] = response
        self._fail_count = 0
        return response

    def open_circuit(self):
        self._circuit_open = True

    def close_circuit(self):
        self._circuit_open = False
        self._fail_count = 0

    def telemetry(self) -> Dict[str, Any]:
        return {"agent": self.id, "status": self.state.get("status"), "last_output": self.state.get("last_output"), "fail_count": self._fail_count}

    def inject_prompt(self, new_prompt: str):
        self.prompt = new_prompt

