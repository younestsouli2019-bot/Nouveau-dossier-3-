"""CLI: `run <brief.json>` produces a draft; `approve <asset_id>` releases it; re-run to publish."""
import argparse
import json
import os
import sys
from pathlib import Path

from .ledger import Ledger

CFG = {
    "workdir": os.environ.get("PROMO_WORKDIR", "out"),
    "approvals_dir": os.environ.get("PROMO_APPROVALS", "approvals"),
    "ledger": os.environ.get("PROMO_LEDGER", "out/ledger.sqlite"),
}


def main(argv=None):
    p = argparse.ArgumentParser(prog="promo-pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run").add_argument("brief")
    sub.add_parser("approve").add_argument("asset_id")
    sub.add_parser("status").add_argument("asset_id")
    a = p.parse_args(argv)

    if a.cmd == "approve":
        d = Path(CFG["approvals_dir"])
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{a.asset_id}.approved").write_text("approved by operator\n")
        print(f"approved {a.asset_id}")
    elif a.cmd == "status":
        print(Ledger(CFG["ledger"]).status(a.asset_id) or "unknown")
    else:
        from .graph import build_graph
        from .steps import pin_to_ipfs, render_scene  # noqa: F401
        from .youtube import upload

        brief = json.loads(Path(a.brief).read_text())
        jwt = os.environ.get("PINATA_JWT")
        graph = build_graph(
            CFG, Ledger(CFG["ledger"]),
            generate=lambda b: [str(s) for s in b["scenes"]],
            publish=upload,
            pin=(lambda path: pin_to_ipfs(path, jwt)) if jwt else (lambda path: ""),
        )
        res = graph.invoke({"asset_id": brief["asset_id"], "brief": brief})
        print(res["status"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
