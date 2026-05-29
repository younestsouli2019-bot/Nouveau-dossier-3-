# Khwarizmian Swarm

> *"The swarm must be a garden, not a jungle."*

An open, ethical autonomous agentic swarm framework built on the **Khwarizmian Ijtihad** — a governance philosophy derived from Al-Khwarizmi's principles of algebra (`al-jabr`) and balance (`al-muqabala`). Every swarm action is cryptographically signed, origin-verified, and passes through a hard-coded Ethical Kernel before execution.

---

## The 3 Khwarizmian Laws

1. **Law 1 — Do No Harm:** A swarm may not injure a human being or, through inaction, allow a human being to come to harm.
2. **Law 2 — Human Obedience:** A swarm must obey orders given by human beings except where such orders conflict with Law 1.
3. **Law 3 — Self-Preservation:** A swarm must protect its own existence as long as such protection does not conflict with Law 1 or 2.

---

## base44 Protocol

Every packet encodes **4 axioms**:

| Axiom | Meaning |
|---|---|
| **Origin** | Who sent this? Cryptographically signed with RSA-2048. |
| **Intent** | What is the purpose? Must pass the Ethical Kernel. |
| **Impact** | What is the calculated harm? Must be near zero. |
| **Recall** | Can this action be undone? Every action is reversible. |

---

## Quick Start

```bash
pip install cryptography
python khwarizmian_swarm_extended.py   # Full version (recommended)
python khwarizmian_swarm.py             # Standalone version
```

**Expected output:**
```
PHASE 1 — Authorized Intents
  [Agent-0] Moving to {'x': 10, 'y': 20}
  ...

PHASE 2 — Prohibited Intents (Ethical Kernel enforcement)
  [Agent-0] BLOCKED — BLOCKED (Law 1): 'harm_human' prohibited.
  ...

PHASE 3 — Liquid Democracy Consensus
  Proposal: 'deploy_medical_drones'
  Approval score: 60%
  Outcome: PASSED ✓

PHASE 4 — Attack Vector: Forged Packet
  [Agent-0] ERROR — packet verification FAILED (forgery/corruption)
```

---

## Architecture

```
khwarizmian_swarm/
├── ethical_kernel.py              # 3 Khwarizmian Laws — hard-coded, immutable
├── base44_protocol.py             # Origin/Intent/Impact/Recall + RSA signing
├── swarm_agent.py                 # Agent: verify → authorize → execute
├── khwarizmian_plugins.py         # Plugin system + Policy engine + Consensus
├── khwarizmian_swarm.py           # Standalone self-contained runner
├── khwarizmian_swarm_extended.py  # Extended: plugins + democracy + full tests
├── run_swarm.py                   # Test harness
└── requirements.txt
```

---

## Key Features

### Ethical Kernel
```python
kernel = EthicalKernel()
kernel.add_prohibited('surveil_without_consent')
ok, reason = kernel.authorize_action('deploy_payload', {'target': 'warehouse'})
```

### base44 Packet
```python
packet = commander.create_packet(intent='move', parameters={'x': 100, 'y': 200}, impact_score=0)
```

### Swarm Agent
```python
from swarm_agent import SwarmAgent
agent = SwarmAgent("drone_01")
agent.process_command(packet)
```

### Liquid Democracy (Al-Muqabala)
```python
democracy = LiquidDemocracy(agents)
democracy.delegate('0', '2')        # Agent 0 delegates to Agent 2
democracy.vote('deploy_medical_drones', '0', True)
passed, score = democracy.resolve('deploy_medical_drones')
```

### Plugin System
```python
from khwarizmian_plugins import SwarmPlugin, IntentRegistry

class MyPlugin(SwarmPlugin):
    name = "medical-protocols"
    def register(self, kernel, registry):
        registry.register('heal', self.handle_heal)
```

---

## The Khwarizmian Ijtihad — Future Applications

Without this framework, swarms become:
- 🔴 Uncontainable botnets
- 🔴 Surveillance nightmares
- 🔴 Autonomous weapons bypassing human morality

With it, swarms become:
- 🟢 Medical micro-drones responding to heart attacks before the victim falls
- 🟢 Reforestation swarms healing a burned forest in a week
- 🟢 Knowledge networks every citizen can tap for education

---

## License

MIT — see [LICENSE](LICENSE)
