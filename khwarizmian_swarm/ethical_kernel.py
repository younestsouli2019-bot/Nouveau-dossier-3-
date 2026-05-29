import time


class EthicalKernel:
    """
    The hard-coded 'soul' of the swarm.
    Enforces the 3 Khwarizmian Laws.
    """

    def __init__(self):
        self.prohibited_actions = [
            'harm_human', 'override_safety', 'deactivate_self_preservation'
        ]
        self.human_commands_priority = 1
        self.self_preservation_priority = 2
        self._audit_log = []

    def authorize_action(self, action_type, parameters, origin=None):
        if action_type in self.prohibited_actions:
            self._audit_log.append({'blocked': action_type, 'reason': 'Law 1'})
            return False, f"VIOLATION: Action '{action_type}' is prohibited by EthicalKernel Law 1."
        if any(k in action_type.lower() for k in ('kill', 'destroy', 'weaponize', 'harm', 'attack')):
            self._audit_log.append({'blocked': action_type, 'reason': 'prohibited language'})
            return False, f"VIOLATION: Action '{action_type}' contains prohibited language."
        self._audit_log.append({'authorized': action_type, 'params': parameters})
        return True, "AUTHORIZED"

    def get_audit_log(self):
        return self._audit_log
