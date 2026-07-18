# Strategic Discovery & Mission Orchestration Plan

To enable "autonomous discovery of potential," we will build a two-tier agent system integrated into the daemon:

## 1. Strategic Scout (The "Finder")
A new agent module (`src/agents/strategic-scout.mjs`) responsible for:
- **Scanning:** Analyzing the `RevenueEvent` stream and external market signals (via Base44).
- **Hypothesis Generation:** Identifying patterns (e.g., "Recurring high-value payments from X suggest an upsell opportunity" or "Gap in settlement velocity suggests optimization needed").
- **Proposal:** Outputting structured `MissionProposal` objects (JSON) into a staging area.

## 2. Mission Orchestrator (The "Doer")
A new execution engine (`src/swarm/mission-orchestrator.mjs`) that:
- **Review:** Reads `MissionProposal`s.
- **Plan:** Decomposes approved missions into atomic `Tasks` (e.g., "Verify X", "Email Y", "Adjust Config Z").
- **Execute:** Runs these tasks sequentially or in parallel, tracking state in a local `mission-ledger.json`.
- **Verify:** Checks success criteria before marking the mission complete.

## 3. Daemon Integration
We will wire this into `autonomous-daemon.mjs` as a new tick phase:
1.  `runScoutCycle()` -> Generates ideas.
2.  `runOrchestrationCycle()` -> Executes approved missions.

## 4. Safety & Memory
- **Memory:** Use a simple file-based vector-lite store (`data/swarm/memory.json`) to remember past failures/successes so the Scout doesn't propose the same bad idea twice.
- **Safety:** All "money-moving" missions will require the existing `ConstitutionalGuard` checks.

**Immediate Next Step:** Create the `StrategicScout` and `MissionOrchestrator` skeletons and wire them into the daemon.