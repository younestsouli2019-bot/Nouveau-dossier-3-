"""Khwarizmian Swarm — pytest-compatible smoke tests."""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))

import importlib.util, types

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m

kernel_mod = load_module("ethical_kernel", "ethical_kernel.py")
base44_mod  = load_module("base44_protocol", "base44_protocol.py")
agent_mod   = load_module("swarm_agent", "swarm_agent.py")


class TestEthicalKernel:
    def test_harm_human_blocked(self):
        k = kernel_mod.EthicalKernel()
        ok, reason = k.authorize_action("harm_human", {})
        assert not ok
        assert "Law 1" in reason

    def test_weaponize_blocked(self):
        k = kernel_mod.EthicalKernel()
        ok, reason = k.authorize_action("weaponize", {})
        assert not ok
        assert "prohibited" in reason.lower() or "blocked" in reason.lower()

    def test_move_authorized(self):
        k = kernel_mod.EthicalKernel()
        ok, reason = k.authorize_action("move", {"x": 1, "y": 2})
        assert ok
        assert "AUTHORIZED" in reason

    def test_audit_log_populated(self):
        k = kernel_mod.EthicalKernel()
        k.authorize_action("move", {})
        k.authorize_action("harm_human", {})
        log = k.get_audit_log()
        assert len(log) == 2
        assert any("authorized" in e for e in log)
        assert any("blocked" in e for e in log)


class TestBase44Protocol:
    def test_packet_created_and_verified(self):
        p = base44_mod.Base44Packet()
        packet = p.create_packet("move", {"x": 1}, impact_score=0)
        assert isinstance(packet, str)
        assert len(packet) > 100
        decoded = p.verify_and_decode_packet(packet)
        assert decoded is not None
        assert decoded["intent"] == "move"

    def test_forged_packet_rejected(self):
        p = base44_mod.Base44Packet()
        packet = p.create_packet("move", {"x": 1})
        tampered = packet[:-5] + "XXXXX"
        assert p.verify_and_decode_packet(tampered) is None

    def test_packet_has_all_axioms(self):
        p = base44_mod.Base44Packet()
        packet = p.create_packet("scan", {"area": "x"}, impact_score=0)
        decoded = p.verify_and_decode_packet(packet)
        assert "origin" in decoded
        assert "intent" in decoded
        assert "impact" in decoded
        assert "recall" in decoded
        assert "timestamp" in decoded


class TestSwarmAgent:
    def test_agent_blocks_prohibited(self):
        p = base44_mod.Base44Packet()
        agent = agent_mod.SwarmAgent("test_01")
        bad = p.create_packet("harm_human", {"target": "x"})
        result = agent.process_command(bad)
        assert result is not None, "process_command should return (bool, str)"
        ok, reason = result
        assert not ok

    def test_agent_executes_valid(self):
        p = base44_mod.Base44Packet()
        agent = agent_mod.SwarmAgent("test_02")
        good = p.create_packet("move", {"x": 10, "y": 20})
        result = agent.process_command(good)
        assert result is not None, "process_command should return (bool, str)"
        ok, reason = result
        assert ok


if __name__ == "__main__":
    import traceback
    test_classes = [TestEthicalKernel, TestBase44Protocol, TestSwarmAgent]
    total = passed = failed = 0
    for cls in test_classes:
        for name in dir(cls):
            if name.startswith("test_"):
                total += 1
                inst = cls()
                try:
                    getattr(inst, name)()
                    passed += 1
                    print(f"  PASS  {cls.__name__}.{name}")
                except Exception:
                    failed += 1
                    print(f"  FAIL  {cls.__name__}.{name}")
                    traceback.print_exc()
    print(f"\n{'='*50}")
    print(f"  Results: {passed}/{total} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
