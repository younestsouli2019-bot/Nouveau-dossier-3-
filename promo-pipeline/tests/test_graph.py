import pytest

from pipeline import graph as g
from pipeline import steps
from pipeline.ledger import Ledger

BRIEF = {
    "project": "RealWorldCerts", "title": "t", "description": "d",
    "link": "https://realworldcerts.com", "audio": "a.wav", "end_card": "e.mp4",
    "scenes": [], "asset_id": "a1",
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(steps, "assemble", lambda *a, **k: "v.mp4")
    cfg = {"workdir": str(tmp_path), "approvals_dir": str(tmp_path / "ap")}
    return cfg, Ledger(str(tmp_path / "l.sqlite")), []


def make(env, monkeypatch, duration=30, approved=False):
    cfg, ledger, published = env
    monkeypatch.setattr(steps, "probe_duration", lambda p: duration)
    graph = g.build_graph(
        cfg, ledger, generate=lambda b: [],
        publish=lambda v, m: published.append(m) or "https://youtu.be/x",
        pin=lambda p: "cid1", approved=lambda aid: approved,
    )
    return graph, ledger, published


def test_unapproved_never_publishes(env, monkeypatch):
    graph, ledger, published = make(env, monkeypatch)
    res = graph.invoke({"asset_id": "a1", "brief": BRIEF})
    assert res["status"] == "pending_approval" and not published
    assert ledger.status("a1") == "pending_approval"


def test_approved_publishes_with_utm_and_license(env, monkeypatch):
    graph, ledger, published = make(env, monkeypatch, approved=True)
    res = graph.invoke({"asset_id": "a1", "brief": BRIEF})
    assert res["status"] == "published" and res["cid"] == "cid1"
    assert "utm_campaign=RealWorldCerts" in published[0]["description"]
    assert "CC BY 4.0" in published[0]["description"]
    assert ledger.status("a1") == "published"


def test_qa_failure_is_bounded(env, monkeypatch):
    graph, ledger, published = make(env, monkeypatch, duration=1)
    res = graph.invoke({"asset_id": "a1", "brief": BRIEF})
    assert res["status"] == "failed_qa" and res["attempts"] == g.MAX_ATTEMPTS
    assert not published
