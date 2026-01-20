import os
import json
import time
from .commercial import pipeline as commercial_pipeline
from .analytics import pipeline as inject_analytics
from .deploy import pipeline as deploy_pipeline
from .assets import pipeline as assets_pipeline
# from .generate import pipeline as generate_pipeline
from .hubs import pipeline as hubs_pipeline
from .site import build_index
from .commercial import write_ab_config as ab_config
from .agents import fetch_recommendations, parse_mission_file, activate_swarm

def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    return out

def choose_growth_topics(domain, catalog_path, logs_dir):
    topics = []
    if os.path.exists(catalog_path):
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        for c in catalog:
            t = c["title"]
            topics.append("How to pass " + t + " fast for " + domain)
            topics.append("Best study plan for " + t + " for " + domain)
            topics.append("Practice exam tips for " + t + " for " + domain)
    leads = read_jsonl(os.path.join(logs_dir, "leads.jsonl"))
    orders = read_jsonl(os.path.join(logs_dir, "orders.jsonl"))
    count = {}
    for x in leads + orders:
        sku = x.get("sku")
        if sku:
            count[sku] = count.get(sku, 0) + 1
    hot = sorted(count.items(), key=lambda k: k[1], reverse=True)[:5]
    hot_skus = [h[0] for h in hot]
    if os.path.exists(catalog_path):
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        for c in catalog:
            if c["sku"] in hot_skus:
                t = c["title"]
                topics.append("Exam day checklist for " + t + " for " + domain)
                topics.append("Avoid common mistakes in " + t + " for " + domain)
    return topics

def write_ab_config(outdir, catalog_path, logs_dir):
    cfg = {}
    orders = read_jsonl(os.path.join(logs_dir, "orders.jsonl"))
    count = {}
    for x in orders:
        sku = x.get("sku")
        if sku:
            count[sku] = count.get(sku, 0) + 1
    top = sorted(count.items(), key=lambda k: k[1], reverse=True)
    for i, (sku, _) in enumerate(top):
        if i == 0:
            cfg[sku] = {"cta": "Enroll Today", "badge": "Top Pick", "deadline": "Sunday 11:59 PM"}
        elif i < 5:
            cfg[sku] = {"cta": "Start Now", "badge": "Popular", "deadline": ""}
    path = os.path.join(outdir, "ab_config.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(cfg, ensure_ascii=False))
    return path

def run_once(domain, outdir):
    # 0. Mode detection (no-simulation sentinel or env)
    nosim = (os.environ.get("NOSIM", "").lower() in ("1", "true", "yes")) or os.path.exists(os.path.join(os.getcwd(), "realworld.nosim"))
    if nosim:
        print("No-simulation mode ENABLED: enforcing real activation and hosting checks")
    # 0. Activate swarm from mission file (if provided), then fetch recommendations
    agent_url = os.environ.get("AGENT_URL", "https://agent-flow-ai-9855ea98.base44.app")
    mission_path = os.environ.get("MISSION_PATH")
    if mission_path and os.path.exists(mission_path):
        print("Parsing mission file and activating swarm...")
        parsed = parse_mission_file(mission_path)
        act = activate_swarm(agent_url, campaign_id=parsed.get("campaign_id"), agent_ids=parsed.get("agent_ids"))
        print(f"Swarm activation: {act}")
        if nosim and (not act.get("campaign") or not act.get("agents")):
            print("WARNING: Swarm activation failed in no-simulation mode. Provide a working AGENT_URL with activate/deploy endpoints.")
    print("Fetching agent recommendations...")
    recos = fetch_recommendations(agent_url, domain)
    if recos:
        print("Agent recommendations received")
    else:
        msg = "No agent recommendations or endpoint unavailable"
        print(msg + (" (no-simulation mode)" if nosim else "; proceeding with defaults"))
    # 1. Generate Commercial Assets (Courses, Bundles, Sales Copy)
    # Focus strictly on SALES assets (Landing Pages, Ad Packs, Email Blasts)
    print("Generating Commercial Sales Assets...")
    comm_stats = commercial_pipeline(domain, outdir, catalog=None, recommendations=recos or None)
    print(f"Commercial: {comm_stats}")

    # 2. Generate Conversion Injection Script (Popup, FOMO, Timer)
    # This injects into the EXISTING website
    from .conversion import generate_booster_script
    print("Generating Conversion Booster Script...")
    generate_booster_script(domain, os.path.join(outdir, "assets"), recommendations=recos or None)

    # 3. Generate Growth/Campaign Assets (Ads, Emails) - NOT free articles
    # We skip article generation to focus on revenue.
    # print("Generating Growth Content...")
    # gen_stats = generate_pipeline(domain, outdir, limit=3) 
    # print(f"Growth: {gen_stats}")

    # 4. Inject Analytics & Tracking (into generated sales pages)
    print("Injecting Analytics...")
    inject_analytics(outdir)

    # 5. Generate A/B Configuration for Sales Boosters
    print("Updating A/B Optimization Config...")
    catalog_path = os.path.join(outdir, "commercial", "catalog.json")
    logs_dir = os.path.join(outdir, "logs")
    os.makedirs(logs_dir, exist_ok=True)
    overrides = None
    if recos and isinstance(recos.get("ab_test"), dict):
        overrides = recos.get("ab_test")
    ab_config(outdir, catalog_path, logs_dir, overrides=overrides)
    
    # Skip full site rebuild (hubs, sitemaps) as we are augmenting an existing site
    print("Updating Hubs & Site Structure...")
    hubs_pipeline(domain, outdir)
    build_index(domain, outdir)
    
    # 6. Deploy / Sync Assets (FTP or GH Pages, depending on env)
    if os.environ.get("FTP_HOST") or os.environ.get("GH_REPO"):
        print("Deploying Sales Assets...")
        result = deploy_pipeline(outdir, domain=domain)
        if nosim and (not result.get("uploaded")):
            print("WARNING: Deployment failed in no-simulation mode. Ensure repo exists or FTP credentials are set.")

def loop(domain, outdir, delay_seconds=3600, iterations=3):
    for _ in range(iterations):
        run_once(domain, outdir)
        time.sleep(delay_seconds)

