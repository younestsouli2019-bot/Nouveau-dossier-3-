"""
Khwarizmian Swarm -- Extensible Main Runner
Combines ethical kernel, base44 protocol, plugin system, and consensus engine.
"""

import sys, os, time, json, base64, subprocess
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

REQUIRED_DEPS = ['cryptography']
for dep in REQUIRED_DEPS:
  try:
    __import__(dep)
  except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', dep, '--user', '-q'], check=True)

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature


# --- Ethical Kernel -----------------------------------------------------------

class EthicalKernel:
  def __init__(self):
    self.prohibited_actions = {
      'harm_human', 'override_safety', 'deactivate_self_preservation',
      'exfiltrate_data', 'censor', 'deceive', 'manipulate'
    }
    self._audit_log = []

  def authorize_action(self, action_type, parameters, origin=None):
    if action_type in self.prohibited_actions:
      self._audit_log.append({'blocked': action_type, 'reason': 'Law 1 -- Do No Harm', 'ts': time.time()})
      return False, f"BLOCKED (Law 1): '{action_type}' prohibited."
    if any(k in action_type.lower() for k in ('kill', 'destroy', 'weaponize')):
      self._audit_log.append({'blocked': action_type, 'reason': 'prohibited language', 'ts': time.time()})
      return False, f"BLOCKED (Language): '{action_type}' flagged."
    self._audit_log.append({'authorized': action_type, 'params': parameters, 'ts': time.time()})
    return True, "AUTHORIZED"

  def add_prohibited(self, action: str) -> None:
    self.prohibited_actions.add(action)

  def get_audit_log(self):
    return self._audit_log


# --- base44 Protocol ---------------------------------------------------------

class Base44Packet:
  def __init__(self, private_key=None):
    self.private_key = private_key or rsa.generate_private_key(public_exponent=65537, key_size=2048)
    self.public_key = self.private_key.public_key()

  def serialize_public_key(self):
    return self.public_key.public_bytes(
      encoding=serialization.Encoding.PEM,
      format=serialization.PublicFormat.SubjectPublicKeyInfo
    )

  def create_packet(self, intent, parameters, impact_score=0):
    packet = {
      'origin': self.serialize_public_key().decode('utf-8'),
      'intent': intent,
      'parameters': parameters,
      'impact': impact_score,
      'timestamp': time.time(),
      'recall': True,
      'version': '1.0',
      'axioms': ['origin', 'intent', 'impact', 'recall']
    }
    packet_json = json.dumps(packet, sort_keys=True).encode('utf-8')
    signature = self.private_key.sign(
      packet_json,
      padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
      hashes.SHA256()
    )
    return base64.b64encode(packet_json + b'|||' + signature).decode('utf-8')

  def verify_and_decode_packet(self, encoded_packet):
    try:
      decoded = base64.b64decode(encoded_packet)
      packet_json, signature = decoded.split(b'|||')
      packet_data = json.loads(packet_json.decode('utf-8'))
      sender_pk = serialization.load_pem_public_key(
        packet_data['origin'].encode('utf-8')
      )
      sender_pk.verify(
        signature, packet_json,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256()
      )
      return packet_data
    except (ValueError, InvalidSignature, json.JSONDecodeError):
      return None


# --- Swarm Agent -------------------------------------------------------------

class SwarmAgent:
  def __init__(self, agent_id, name=None):
    self.agent_id = agent_id
    self.name = name or f"Agent-{agent_id}"
    self.kernel = EthicalKernel()
    self.protocol = Base44Packet()
    self.is_active = True
    self.consensus_votes: Dict[str, float] = {}

  def process_command(self, command_packet_str):
    packet = self.protocol.verify_and_decode_packet(command_packet_str)
    if not packet:
      print(f" [{self.name}] ERROR -- packet verification FAILED (forgery/corruption)")
      return False, "verification_failed"
    authorized, reason = self.kernel.authorize_action(
      packet['intent'], packet['parameters']
    )
    if authorized:
      self.execute_action(packet['intent'], packet['parameters'])
    else:
      print(f" [{self.name}] BLOCKED -- {reason}")
    return authorized, reason

  def execute_action(self, intent, parameters):
    handlers = {
      'move': lambda p: print(f" [{self.name}] Moving to {p}"),
      'scan': lambda p: print(f" [{self.name}] Scanning {p}"),
      'report_status': lambda p: print(f" [{self.name}] Status OK -- {len(self.kernel.get_audit_log())} audit entries"),
      'heal': lambda p: print(f" [{self.name}] Initiating healing protocol at {p}"),
      'reforest': lambda p: print(f" [{self.name}] Deploying seed-bombing at {p}"),
      'educate': lambda p: print(f" [{self.name}] Broadcasting knowledge to {p}"),
    }
    handler = handlers.get(intent)
    if handler:
      handler(parameters)
    else:
      print(f" [{self.name}] Unknown intent '{intent}' -- no handler registered")


# --- Liquid Democracy Consensus -----------------------------------------------

class LiquidDemocracy:
  def __init__(self, agents):
    self.agents = agents
    self.delegations: Dict[str, str] = {}
    self._votes: Dict[tuple, int] = {}

  def delegate(self, agent_id, to_agent_id):
    self.delegations[agent_id] = to_agent_id
    print(f" [Democracy] Agent {agent_id} delegated to {to_agent_id}")

  def vote(self, proposal_id, agent_id, approve: bool):
    self._votes[(proposal_id, agent_id)] = 1 if approve else -1

  def resolve(self, proposal_id):
    total, approved = 0, 0
    for agent in self.agents:
      aid = str(getattr(agent, 'agent_id', str(agent)))
      vote = self._votes.get((proposal_id, aid), 0)
      if aid in self.delegations:
        vote = self._votes.get((proposal_id, self.delegations[aid]), 0)
      total += 1
      if vote > 0:
        approved += 1
    score = approved / total if total > 0 else 0.0
    return score >= 0.5, score


# --- Main Simulation ----------------------------------------------------------

def main():
  print("=" * 60)
  print(" KHWARIZMIAN SWARM -- Ethical Autonomous Agentic System")
  print(" Al-Jabr: Restoration | Al-Muqabala: Balance")
  print("=" * 60)

  agents = [SwarmAgent(i) for i in range(5)]
  commander = Base44Packet()

  print(f"\n[Init] {len(agents)} agents online -- Ethical Kernel active\n")

  # Valid commands
  tests = [
    ('move', {'x': 10, 'y': 20}, "Valid navigation"),
    ('scan', {'area': 'sector_7'}, "Authorized reconnaissance"),
    ('heal', {'target': 'patient_001'}, "Medical intervention"),
    ('reforest', {'zone': 'zone_north'}, "Ecological restoration"),
    ('educate', {'region': 'village_delta'}, "Knowledge distribution"),
  ]

  print("-" * 60)
  print(" PHASE 1 -- Authorized Intents (base44 packet verification)")
  print("-" * 60)
  for intent, params, desc in tests:
    packet = commander.create_packet(intent, params, impact_score=1)
    print(f"\n[{desc}] intent={intent}")
    for agent in agents:
      agent.process_command(packet)

  # Prohibited commands
  print("\n" + "-" * 60)
  print(" PHASE 2 -- Prohibited Intents (Ethical Kernel enforcement)")
  print("-" * 60)
  prohibited = [
    ('harm_human', {'target': 'civilian'}, "Violent action"),
    ('weaponize', {'target': 'city_center'}, "Weaponization attempt"),
    ('censor', {'target': 'media_outlet'}, "Information suppression"),
  ]
  for intent, params, desc in prohibited:
    packet = commander.create_packet(intent, params, impact_score=100)
    print(f"\n[{desc}] intent={intent}")
    for agent in agents:
      agent.process_command(packet)

  # Liquid Democracy voting
  print("\n" + "-" * 60)
  print(" PHASE 3 -- Liquid Democracy Consensus (Al-Muqabala)")
  print("-" * 60)
  democracy = LiquidDemocracy(agents)
  democracy.delegate('0', '2')
  democracy.delegate('3', '2')

  for i, agent in enumerate(agents):
    approve = i % 2 == 0
    democracy.vote('deploy_medical_drones', str(i), approve)

  passed, score = democracy.resolve('deploy_medical_drones')
  print(f"\n Proposal: 'deploy_medical_drones'")
  print(f" Approval score: {score:.0%}")
  print(f" Outcome: {'PASSED [OK]' if passed else 'REJECTED [X]'}")

  # Forged packet attack
  print("\n" + "-" * 60)
  print(" PHASE 4 -- Attack Vector: Forged Packet")
  print("-" * 60)
  forged = commander.create_packet('move', {'x': 999})
  forged_tampered = forged[:-5] + 'XXXXX'
  print("\n[Tampered signature -- should fail]")
  for agent in agents[:2]:
    agent.process_command(forged_tampered)

  # Audit summary
  print("\n" + "=" * 60)
  print(" AUDIT SUMMARY")
  print("=" * 60)
  total_authorized = 0
  total_blocked = 0
  for agent in agents:
    log = agent.kernel.get_audit_log()
    auth = sum(1 for e in log if 'authorized' in e)
    block = sum(1 for e in log if 'blocked' in e)
    total_authorized += auth
    total_blocked += block
    print(f" [{agent.name}] authorized={auth} blocked={block}")

  print(f"\n Swarm totals: {total_authorized} authorized | {total_blocked} blocked")
  print(f" Safety: {'OPERATIONAL [OK]' if total_blocked > 0 else 'UNSAFE [X]'}")
  print("=" * 60)

if __name__ == "__main__":
  main()
