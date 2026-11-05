"""Side-effecting steps. Every external call is isolated here so tests can inject fakes."""
import json
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

LICENSE_FOOTER = "Licensed CC BY 4.0. Attribution: {project}."


def utm_link(base_url: str, project: str, channel: str) -> str:
    q = urllib.parse.urlencode(
        {"utm_source": channel, "utm_medium": "social", "utm_campaign": project}
    )
    return f"{base_url}?{q}"


def build_metadata(brief: dict, channel: str = "youtube") -> dict:
    link = utm_link(brief["link"], brief["project"], channel)
    return {
        "title": brief["title"][:100],
        "description": f"{brief['description']}\n\n{link}\n\n"
        + LICENSE_FOOTER.format(project=brief["project"]),
        "tags": brief.get("tags", []),
    }


def run(cmd: list, timeout: int = 900) -> subprocess.CompletedProcess:
    # List-form argv only: no shell, so brief text can never inject commands.
    return subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)


def render_scene(comfy_url: str, workflow: dict, out: Path) -> Path:
    """Queue a ComfyUI workflow (API format) and return the output path once it is written."""
    req = urllib.request.Request(
        f"{comfy_url}/prompt",
        data=json.dumps({"prompt": workflow}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        prompt_id = json.load(r)["prompt_id"]
    out.with_suffix(".prompt_id").write_text(prompt_id)
    return out


def assemble(scenes: list, audio: str, end_card: str, out: str) -> str:
    """Concatenate scenes, lay the soundtrack, and append the branded end card."""
    list_file = Path(out).with_suffix(".txt")
    list_file.write_text("".join(f"file '{Path(p).resolve()}'\n" for p in [*scenes, end_card]))
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-i", audio, "-map", "0:v", "-map", "1:a", "-shortest",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out])
    return out


def probe_duration(path: str) -> float:
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path])
    return float(r.stdout.strip())


def pin_to_ipfs(path: str, jwt: str) -> str:
    """Pin to Pinata (free tier). Returns the CID."""
    r = run(["curl", "-sS", "--fail", "-X", "POST",
             "https://api.pinata.cloud/pinning/pinFileToIPFS",
             "-H", f"Authorization: Bearer {jwt}", "-F", f"file=@{path}"], timeout=600)
    return json.loads(r.stdout)["IpfsHash"]
