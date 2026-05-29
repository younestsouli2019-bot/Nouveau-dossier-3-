"""Seed Khwarizmian Swarm to external platforms (HuggingFace Spaces, GitLab, Codeberg)."""
import subprocess, sys, os, json, base64

GH_TOKEN = os.environ.get("GH_TOKEN", "")
GH_API = "https://api.github.com"

def gh_api(method, path, data=None):
    import urllib.request, urllib.error
    url = GH_API + path
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"token {GH_TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

def make_template():
    print("[GitHub] Setting khwarizmian_swarm as GitHub Template repo...")
    data, status = gh_api("PATCH", "/repos/younestsouli2019-bot/Nouveau-dossier-3-", {"is_template": True})
    print(f"  Status {status}: {data.get('is_template', data)}")

def seed_gitlab():
    """Seed to GitLab - requires GL_TOKEN env var."""
    gl_token = os.environ.get("GL_TOKEN", "")
    if not gl_token:
        print("[GitLab] GL_TOKEN not set — skipping. Set it to seed a mirror.")
        return
    print("[GitLab] Mirroring khwarizmian_swarm...")
    print("  Run manually: glab repo create khwarizmian-swarm --public --import-url https://github.com/younestsouli2019-bot/Nouveau-dossier-3-")

def seed_huggingface():
    """Seed to HuggingFace Spaces — requires HF_TOKEN env var."""
    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        print("[HuggingFace] HF_TOKEN not set — skipping. Set it to create a Space.")
        return
    print("[HuggingFace] Creating Space 'khwarizmian-swarm'...")
    import urllib.request, json
    req = urllib.request.Request(
        "https://huggingface.co/api/spaces",
        data=json.dumps({
            "name": "khwarizmian-swarm",
            "repository_type": "gradio",
            "private": False,
            "hardware": "cpu-basic",
        }).encode(),
        method="POST"
    )
    req.add_header("Authorization", f"Bearer {hf_token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            print(f"  Created: {json.loads(r.read())}")
    except urllib.error.HTTPError as e:
        print(f"  HF Error: {e.read()}")

def seed_codeberg():
    print("[Codeberg] To mirror: pip install git-repo; git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-")
    print("  Then push to Codeberg: git remote add origin https://codeberg.org/your-user/khwarizmian-swarm.git")

if __name__ == "__main__":
    print("=== Seeding Khwarizmian Swarm to External Platforms ===\n")
    if GH_TOKEN:
        make_template()
    else:
        print("[GitHub] GH_TOKEN not set — skipping template setup.")
        print("  To enable: Settings > Repository > Template repository")
    seed_gitlab()
    seed_huggingface()
    seed_codeberg()
    print("\nDone.")
