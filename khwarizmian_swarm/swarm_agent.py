from ethical_kernel import EthicalKernel
from base44_protocol import Base44Packet


class SwarmAgent:
    def __init__(self, agent_id):
        self.agent_id = agent_id
        self.kernel = EthicalKernel()
        self.protocol = Base44Packet()
        self.is_active = True

    def process_command(self, command_packet_str):
        print(f"Agent {self.agent_id}: Received packet.")
        command = self.protocol.verify_and_decode_packet(command_packet_str)
        if not command:
            print(f"Agent {self.agent_id}: ERROR - Packet verification failed. Possible forgery.")
            return False, "verification_failed"
        intent = command['intent']
        parameters = command['parameters']
        is_authorized, reason = self.kernel.authorize_action(intent, parameters)
        if is_authorized:
            print(f"Agent {self.agent_id}: EXECUTING {intent} with params {parameters}.")
            self.execute_action(intent, parameters)
        else:
            print(f"Agent {self.agent_id}: BLOCKED - {reason}")
        return is_authorized, reason

    def execute_action(self, intent, parameters):
        handlers = {
            'move': lambda p: print(f"Agent {self.agent_id}: Moving to {p}."),
            'scan': lambda p: print(f"Agent {self.agent_id}: Scanning area {p}."),
            'heal': lambda p: print(f"Agent {self.agent_id}: Initiating healing protocol at {p}."),
            'reforest': lambda p: print(f"Agent {self.agent_id}: Deploying seed-bombing at {p}."),
            'educate': lambda p: print(f"Agent {self.agent_id}: Broadcasting knowledge to {p}."),
            'report_status': lambda p: print(f"Agent {self.agent_id}: Status OK. Audit log: {len(self.kernel.get_audit_log())} entries."),
        }
        handler = handlers.get(intent)
        if handler:
            handler(parameters)
        else:
            print(f"Agent {self.agent_id}: Performing generic action '{intent}'.")
