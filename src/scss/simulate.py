"""Simulator demonstrating SCSS loop: agent failure -> circuit breaker -> rectifier -> resume.
Run: python -m src.scss.simulate
"""

import asyncio
from src.scss.event_bus import AsyncEventBus
from src.scss.agent import Agent
from src.scss.synchronizer import Synchronizer
from src.scss.rectifier import DriftDetector, MetaPromptGovernor, Rectifier

async def main():
    bus = AsyncEventBus()
    sync = Synchronizer()
    detector = DriftDetector(fail_threshold=2)
    governor = MetaPromptGovernor()
    rectifier = Rectifier(detector, governor)

    # create agents
    lead = Agent("Lead_Closer", "You are Lead_Closer: close deals ethically.")
    data_fixer = Agent("Data_Fixer", "You are Data_Fixer: attempt to repair malformed payloads.")

    # register in synchronizer
    sync.register_agent(lead.id, [data_fixer.id])
    sync.register_agent(data_fixer.id, [])

    async def handle_telemetry(msg):
        agent_id = msg.get("agent")
        telemetry = msg
        # update vector ledger with a simple serial of last_output as doc
        doc = str(telemetry.get("last_output"))
        sync.update_state_vector(agent_id, doc)
        # inspect for drift
        if agent_id == lead.id:
            patched = rectifier.inspect_and_patch(lead, telemetry)
            if patched.get("patched"):
                print(f"Rectifier patched {lead.id}: {patched}")
                # simulate alerting and move broken payload to Data_Fixer via bus
                await bus.publish("data_fixer_channel", {"from": lead.id, "corrupt": True})

    # subscribe to telemetry
    await bus.subscribe("telemetry", handle_telemetry)

    async def data_fixer_handler(msg):
        print("Data_Fixer received DLQ-like payload:", msg)
        # Attempt to fix then re-publish to lead
        fixed = {"repaired": True}
        await asyncio.sleep(0.1)
        await bus.publish("lead_channel", fixed)

    await bus.subscribe("data_fixer_channel", data_fixer_handler)

    async def lead_handler(msg):
        # lead processes incoming payloads
        out = await lead.process(msg)
        # publish telemetry
        telemetry = {"agent": lead.id, "last_output": out, "fail_count": lead._fail_count}
        await bus.publish("telemetry", telemetry)
        # if out is success, print and close circuit
        if out.get("result"):
            print("Lead succeeded after fix:", out)
            lead.close_circuit()

    await bus.subscribe("lead_channel", lead_handler)

    # Seed a corrupt payload that will trigger loop/failure
    await bus.publish("lead_channel", {"corrupt": True})

    # let the system run for a few seconds
    await asyncio.sleep(3)
    dlqs = await bus.get_dead_letters()
    print("Dead letters: ", dlqs)

if __name__ == "__main__":
    asyncio.run(main())
