import os
import json
import re

# Try to use requests if available, else fall back to urllib
try:
    import requests  # type: ignore
except Exception:
    requests = None
    import urllib.request
    import urllib.error

def _http_get(url, timeout=8):
    if requests:
        try:
            r = requests.get(url, timeout=timeout, headers={"Accept": "application/json"})
            if r.status_code == 200:
                return r.text
        except Exception:
            return None
    else:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except Exception:
            return None
    return None

def fetch_recommendations(base_url, domain):
    """
    Fetches revenue optimization recommendations from autonomous swarm agents.
    Returns a dict with keys:
      - boosters: { fomo: {enabled, interval, sales}, timer: {enabled, end, bannerText}, exitIntent: {enabled, discount} }
      - ab_test: { sku: { cta, badge, deadline } }
      - campaigns: { sku: { facebook_ads: [csv lines], google_ads: [csv lines], email_blast: str } }
    Gracefully degrades to {} if endpoint is unavailable or non-JSON.
    """
    base_url = (base_url or "").rstrip("/")
    if not base_url:
        return {}
    candidates = [
        f"{base_url}/api/recommendations?domain={domain}",
        f"{base_url}/recommendations?domain={domain}",
        f"{base_url}/api/recommendations",
        f"{base_url}/recommendations",
        base_url,
    ]
    text = None
    for url in candidates:
        text = _http_get(url, timeout=8)
        if text:
            break
    if not text:
        return {}
    # Attempt to parse JSON; if plain HTML or text, ignore
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}

def parse_mission_file(path):
    """
    Parses a mission log/text file to extract:
      - campaign_id
      - agent_ids list
    Returns dict { 'campaign_id': str|None, 'agent_ids': [str] }
    """
    out = {"campaign_id": None, "agent_ids": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            txt = f.read()
    except Exception:
        return out
    # Campaign id: look near "create_campaign" section
    lines = txt.splitlines()
    camp_idx = None
    for i, line in enumerate(lines):
        if "create_campaign" in line:
            camp_idx = i
            break
    if camp_idx is not None:
        window = "\n".join(lines[camp_idx:camp_idx+100])
        m = re.findall(r"'id':\s*'([0-9a-fA-F]{24,})'", window)
        if m:
            out["campaign_id"] = m[-1]
    # Agent ids: collect all 'id' occurrences inside create_agent blocks
    agent_ids = []
    i = 0
    while i < len(lines):
        if "create_agent" in lines[i]:
            block = "\n".join(lines[i:i+80])
            ids = re.findall(r"'id':\s*'([0-9a-fA-F]{24,})'", block)
            agent_ids.extend(ids)
            i += 80
        else:
            i += 1
    # Also capture any explicit agents list
    agents_list_ids = re.findall(r"agents:\s*\[\s*([^\]]+)\]", txt)
    for chunk in agents_list_ids:
        ids = re.findall(r"'([0-9a-fA-F]{24,})'", chunk)
        agent_ids.extend(ids)
    # Deduplicate
    out["agent_ids"] = list(dict.fromkeys(agent_ids))
    return out

def activate_swarm(base_url, campaign_id=None, agent_ids=None):
    """
    Attempts to activate/deploy a campaign and agents on the swarm platform.
    Tries multiple endpoints defensively.
    Returns dict with booleans: {'campaign': True/False, 'agents': True/False}
    """
    res = {"campaign": False, "agents": False}
    base = (base_url or "").rstrip("/")
    if not base:
        return res
    def _post(url, payload=None):
        if requests:
            try:
                r = requests.post(url, json=payload or {}, timeout=8, headers={"Accept": "application/json"})
                return 200 <= r.status_code < 300
            except Exception:
                return False
        else:
            try:
                data = json.dumps(payload or {}).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    code = getattr(resp, "status", 200)
                    return 200 <= code < 300
            except Exception:
                return False
    # Campaign activation
    if campaign_id:
        urls = [
            f"{base}/api/campaigns/{campaign_id}/activate",
            f"{base}/api/campaigns/{campaign_id}/deploy",
            f"{base}/campaigns/{campaign_id}/activate",
            f"{base}/campaigns/{campaign_id}/deploy",
            f"{base}/api/activate?campaign_id={campaign_id}",
        ]
        for u in urls:
            if _post(u, {"campaign_id": campaign_id}):
                res["campaign"] = True
                break
    # Agents deployment
    ids = agent_ids or []
    if ids:
        urls = [
            f"{base}/api/agents/deploy",
            f"{base}/agents/deploy",
            f"{base}/api/deploy_agents",
        ]
        payload = {"ids": ids}
        for u in urls:
            if _post(u, payload):
                res["agents"] = True
                break
    return res
