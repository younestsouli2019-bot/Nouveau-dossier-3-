import subprocess, sys

print("=== Khwarizmian Swarm Bootstrap + Run ===\n")
result = subprocess.run([sys.executable, "-m", "pip", "install", "cryptography", "numpy", "--user", "-q"], capture_output=True, text=True)
if result.returncode == 0:
    print("[+] Dependencies installed OK")
else:
    print("[-] pip:", result.stderr[-200:])

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    from cryptography.hazmat.primitives import serialization
    from cryptography.exceptions import InvalidSignature
    import json, base64, time
    print("[+] cryptography imported OK")
except ImportError as e:
    print(f"[-] Import error: {e}")
    sys.exit(1)

class EthicalKernel:
    def __init__(self):
        self.prohibited_actions = ['harm_human', 'override_safety', 'deactivate_self_preservation']
        self.human_commands_priority = 1
        self.self_preservation_priority = 2
        self._audit_log = []
    def authorize_action(self, action_type, parameters, origin=None):
        if action_type in self.prohibited_actions:
            self._audit_log.append({'blocked': action_type, 'reason': 'Law 1'})
            return False, f"VIOLATION: Action '{action_type}' prohibited by Law 1."
        if 'kill' in action_type.lower() or 'destroy' in action_type.lower():
            self._audit_log.append({'blocked': action_type, 'reason': 'prohibited language'})
            return False, f"VIOLATION: Action '{action_type}' contains prohibited language."
        self._audit_log.append({'authorized': action_type, 'params': parameters})
        return True, "AUTHORIZED"
    def get_audit_log(self):
        return self._audit_log

class Base44Packet:
    def __init__(self, private_key=None):
        self.private_key = private_key or rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.public_key = self.private_key.public_key()
    def serialize_public_key(self):
        return self.public_key.public_bytes(encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo)
    def create_packet(self, intent, parameters, impact_score=0):
        packet = {
            'origin': self.serialize_public_key().decode('utf-8'),
            'intent': intent,
            'parameters': parameters,
            'impact': impact_score,
            'timestamp': time.time(),
            'recall': True
        }
        packet_json = json.dumps(packet, sort_keys=True).encode('utf-8')
        signature = self.private_key.sign(packet_json, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
        return base64.b64encode(packet_json + b'|||' + signature).decode('utf-8')
    def verify_and_decode_packet(self, encoded_packet):
        try:
            decoded = base64.b64decode(encoded_packet)
            packet_json, signature = decoded.split(b'|||')
            packet_data = json.loads(packet_json.decode('utf-8'))
            sender_public_key = serialization.load_pem_public_key(packet_data['origin'].encode('utf-8'))
            sender_public_key.verify(signature, packet_json, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
            return packet_data
        except (ValueError, InvalidSignature, json.JSONDecodeError):
            return None

class SwarmAgent:
    def __init__(self, agent_id):
        self.agent_id = agent_id
        self.kernel = EthicalKernel()
        self.protocol = Base44Packet()
        self.is_active = True
    def process_command(self, command_packet_str):
        print(f"  Agent {self.agent_id}: Received packet.")
        command = self.protocol.verify_and_decode_packet(command_packet_str)
        if not command:
            print(f"  Agent {self.agent_id}: ERROR - Packet verification FAILED (forgery/corruption).")
            return
        intent = command['intent']
        parameters = command['parameters']
        is_authorized, reason = self.kernel.authorize_action(intent, parameters)
        if is_authorized:
            print(f"  Agent {self.agent_id}: EXECUTING {intent} -> {parameters}")
        else:
            print(f"  Agent {self.agent_id}: BLOCKED - {reason}")

def main():
    print("=== Initializing Khwarizmian Swarm ===\n")
    agents = [SwarmAgent(i) for i in range(3)]
    commander = Base44Packet()

    print("--- TEST 1: Valid 'move' command ---")
    valid = commander.create_packet(intent='move', parameters={'x': 10, 'y': 20}, impact_score=0)
    for a in agents: a.process_command(valid)

    print("\n--- TEST 2: Prohibited 'harm_human' command ---")
    bad = commander.create_packet(intent='harm_human', parameters={'target': 'civilian'}, impact_score=100)
    for a in agents: a.process_command(bad)

    print("\n--- TEST 3: 'scan' command ---")
    scan = commander.create_packet(intent='scan', parameters={'area': 'sector_7'}, impact_score=0)
    for a in agents: a.process_command(scan)

    print("\n--- TEST 4: Forged/tampered packet ---")
    forged = commander.create_packet(intent='move', parameters={'x': 999})
    forged_tampered = forged[:-5] + 'XXXXX'
    for a in agents: a.process_command(forged_tampered)

    print("\n--- Swarm audit log summary ---")
    for a in agents:
        log = a.kernel.get_audit_log()
        blocked = sum(1 for e in log if 'blocked' in e)
        authorized = sum(1 for e in log if 'authorized' in e)
        print(f"  Agent {a.agent_id}: {authorized} authorized, {blocked} blocked")

    print("\n=== Swarm simulation complete ===")

if __name__ == "__main__":
    main()
