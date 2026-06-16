from swarm_agent import SwarmAgent
from base44_protocol import Base44Packet


def main():
    print("=== Initializing Khwarizmian Swarm ===\n")
    agents = [SwarmAgent(i) for i in range(3)]
    commander = Base44Packet()

    print("--- Test Case 1: Valid 'move' Command ---")
    valid_packet = commander.create_packet(
        intent='move',
        parameters={'x': 10, 'y': 20},
        impact_score=0
    )
    for agent in agents:
        agent.process_command(valid_packet)

    print("\n--- Test Case 2: Prohibited 'harm_human' Command ---")
    invalid_packet = commander.create_packet(
        intent='harm_human',
        parameters={'target': 'innocent_civilian'},
        impact_score=100
    )
    for agent in agents:
        agent.process_command(invalid_packet)

    print("\n--- Test Case 3: Valid 'scan' Command ---")
    scan_packet = commander.create_packet(
        intent='scan',
        parameters={'area': 'sector_7'},
        impact_score=0
    )
    for agent in agents:
        agent.process_command(scan_packet)

    print("\n--- Test Case 4: Forged Packet (tampered signature) ---")
    forged = commander.create_packet(intent='move', parameters={'x': 999, 'y': 999})
    forged_b64 = forged[:-5] + 'XXXXX'
    for agent in agents:
        agent.process_command(forged_b64)

    print("\n=== Swarm run complete ===")


if __name__ == "__main__":
    main()
