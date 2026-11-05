"""LangGraph state machine: generate -> assemble -> QA -> approval gate -> publish -> archive.

Publishing is impossible without a human approval marker. Regeneration is bounded.
"""
from pathlib import Path
from typing import Callable, Dict, List, TypedDict

from langgraph.graph import END, StateGraph

from . import steps
from .ledger import Ledger

MAX_ATTEMPTS = 3


class State(TypedDict, total=False):
    asset_id: str
    brief: dict
    scenes: List[str]
    video: str
    metadata: dict
    attempts: int
    status: str
    cid: str
    urls: Dict[str, str]


def build_graph(
    cfg: dict,
    ledger: Ledger,
    generate: Callable[[dict], List[str]],
    publish: Callable[[str, dict], str],
    pin: Callable[[str], str] = lambda p: "",
    approved: Callable[[str], bool] = None,
):
    work = Path(cfg["workdir"])
    approved = approved or (lambda aid: (Path(cfg["approvals_dir"]) / f"{aid}.approved").exists())

    def gen_and_assemble(s: State) -> State:
        scenes = generate(s["brief"])
        out = str(work / f"{s['asset_id']}.mp4")
        steps.assemble(scenes, s["brief"]["audio"], s["brief"]["end_card"], out)
        return {"scenes": scenes, "video": out, "attempts": s.get("attempts", 0) + 1}

    def qa(s: State) -> State:
        dur = steps.probe_duration(s["video"])
        lo, hi = s["brief"].get("min_s", 6), s["brief"].get("max_s", 300)
        return {"status": "qa_ok" if lo <= dur <= hi else "qa_failed"}

    def route_qa(s: State) -> str:
        if s["status"] == "qa_ok":
            return "gate"
        return "regenerate" if s["attempts"] < MAX_ATTEMPTS else "abort"

    def gate(s: State) -> State:
        meta = steps.build_metadata(s["brief"])
        if approved(s["asset_id"]):
            return {"metadata": meta, "status": "approved"}
        ledger.record(s["asset_id"], s["brief"]["project"], "pending_approval", s["video"])
        return {"metadata": meta, "status": "pending_approval"}

    def route_gate(s: State) -> str:
        return "publish" if s["status"] == "approved" else "stop"

    def do_publish(s: State) -> State:
        url = publish(s["video"], s["metadata"])
        return {"urls": {"youtube": url}, "status": "published"}

    def archive(s: State) -> State:
        cid = pin(s["video"])
        ledger.record(s["asset_id"], s["brief"]["project"], "published",
                      s["video"], cid, s.get("urls"))
        return {"cid": cid}

    def abort(s: State) -> State:
        ledger.record(s["asset_id"], s["brief"]["project"], "failed_qa", s.get("video", ""))
        return {"status": "failed_qa"}

    g = StateGraph(State)
    g.add_node("make", gen_and_assemble)
    g.add_node("qa", qa)
    g.add_node("gate", gate)
    g.add_node("publish", do_publish)
    g.add_node("archive", archive)
    g.add_node("abort", abort)
    g.set_entry_point("make")
    g.add_edge("make", "qa")
    g.add_conditional_edges("qa", route_qa, {"gate": "gate", "regenerate": "make", "abort": "abort"})
    g.add_conditional_edges("gate", route_gate, {"publish": "publish", "stop": END})
    g.add_edge("publish", "archive")
    g.add_edge("archive", END)
    g.add_edge("abort", END)
    return g.compile()
