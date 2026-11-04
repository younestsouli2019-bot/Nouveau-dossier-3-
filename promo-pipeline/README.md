# promo-pipeline

Self-hosted, free-tier pipeline for publishing promotional video content for RealWorldCerts and the swarm projects.
It adapts the self-publishing protocol (permanent copy, licence, discovery link, archive) to promo media.

```
brief.json -> ComfyUI scenes (Wan 2.2 5B) -> ffmpeg + end card -> QA (duration, max 3 attempts)
           -> HUMAN APPROVAL -> YouTube upload (private by default) -> IPFS pin -> ledger
```

| Manual layer | Here |
|---|---|
| Legal | CC BY 4.0 footer appended to every description |
| Host | Your own site / GitHub Releases; YouTube is distribution only |
| Discovery | UTM-tagged link to the brief's `link` |
| Archive | Pinata free tier pin (set `PINATA_JWT`) |
| Log | SQLite ledger (`PROMO_LEDGER`) |

## Safety properties
- `publish` is unreachable without `approvals/<asset_id>.approved` (`python -m pipeline.cli approve <id>`).
- Regeneration is capped at 3 attempts; subprocesses use argv lists (no shell); the compose file has no `docker.sock`, drops all capabilities and is read-only.
- Credentials come from environment variables only. Keep them separate from the payout/settlement credentials used elsewhere in this repo.
- Uploads default to `private`; set `YT_PRIVACY=public` deliberately.

## Usage
```
pip install -r requirements.txt
python -m pipeline.cli run brief.json     # -> pending_approval
python -m pipeline.cli approve <asset_id>
python -m pipeline.cli run brief.json     # -> published
pytest tests
```

Brief fields: `asset_id, project, title, description, link, audio, end_card, scenes[]` (rendered clip paths), optional `tags, min_s, max_s`.
Scene rendering via `steps.render_scene` (ComfyUI `/prompt` API) is a thin queueing helper; wire the polling/download step to your workflow.
