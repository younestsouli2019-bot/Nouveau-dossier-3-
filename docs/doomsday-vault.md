# Doomsday Vault & Secure Cloud

## Why
Total repo + state backup that can be restored from anywhere. Survives:
- GitHub repo deletion
- Base44 app deletion
- Local machine loss
- Credentials leak
- Regional outages

## What it backs up

| Section | Source | Content |
|---|---|---|
| `data/base44/flow/` | agent-flow-ai app | PayoutBatch, RevenueEvent, RevenueStream, Analytics, Task |
| `data/base44/swarm/` | agent-swarm app | RevenueStream, PayoutBatch, Task |
| `data/exports/` | `exports/` | All wire instructions, settlement logs, reports |
| `data/workflows/` | `.github/workflows/` | All workflow definitions |
| `data/scripts/` | `scripts/` | All automation scripts |
| `data/docs/` | `docs/` | All documentation |
| `data/swarm_overrides/` | `swarm-overrides/` | Runner control files |
| `data/legacy_doomsday/` | `backups/doomsday/snapshot_20260320-233845/` | Payer registry + financial ledger |

Each file in the snapshot has a SHA-256 hash. The `manifest.json` is the recovery key — keep a copy off-site.

## Output

```
exports/doomsday/
├── snapshot_YYYYMMDD_HHmmss/      # full directory (uncompressed)
│   ├── manifest.json               # checksums + section report
│   ├── data/
│   │   ├── base44/                 # entity dumps as JSONL
│   │   ├── exports/                # local exports
│   │   ├── workflows/              # .github/workflows
│   │   ├── scripts/                # all scripts
│   │   ├── docs/                   # all docs
│   │   ├── swarm_overrides/        # runner control
│   │   └── legacy_doomsday/        # preserved legacy snapshot
│   └── ...
├── snapshot_YYYYMMDD_HHmmss.zip    # archive
├── snapshot_YYYYMMDD_HHmmss.zip.enc # AES-256-GCM encrypted (optional)
├── vault_latest.json                # summary
└── vault_log_last.txt
```

## Encryption

Set `DOOMSDAY_ENCRYPT=true` (default in workflow) → snapshot is GPG-symmetric-AES256 encrypted with passphrase from `DOOMSDAY_PASSPHRASE` secret.

Set `DOOMSDAY_CLOUD_ENCRYPT=true` → file is additionally encrypted client-side with AES-256-GCM before cloud upload (extra layer if bucket is compromised).

## Secure Cloud Providers (auto-detected)

| Provider | Secrets required |
|---|---|
| AWS S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DOOMSDAY_S3_BUCKET` |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Backblaze B2 | `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` |
| MinIO / Custom | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` |

The script auto-detects whichever is configured. R2 is recommended: $0 egress, $0.015/GB/month, 10GB free.

## Schedule

- **Daily 02:00 UTC** — `doomsday-vault.yml` runs
  - `vault` job: creates snapshot, uploads as artifact (30-day retention)
  - `upload` job (on `workflow_dispatch`): uploads to cloud

## Manual trigger

```bash
# Local run (CI mode)
node swarm-overrides/scripts/doomsday-vault.mjs

# Encrypted local + cloud
DOOMSDAY_ENCRYPT=true DOOMSDAY_PASSPHRASE=strong-passphrase \
  node swarm-overrides/scripts/secure-cloud-upload.mjs
```

Or trigger via GitHub Actions UI → Doomsday Vault → Run workflow.

## Recovery

To restore from a vault:
1. Get `manifest.json` (kept off-site) + the zip
2. Decrypt if needed: `gpg -d snapshot.zip.enc > snapshot.zip`
3. Unzip: `unzip snapshot.zip -d restored/`
4. Inspect `manifest.json` to verify checksums
5. Import JSONL into Base44 (one entity per line)
6. Restore `swarm-overrides/` to repo root
7. Restore `docs/`, `scripts/`, `.github/workflows/` as needed

## Audit trail

Each vault run writes to Base44 Analytics. Search `metric_type: doomsday_vault_created` for full history.

## Status

Last vault snapshot: `backups/doomsday/snapshot_20260320-233845/` (2026-03-20, 4 months ago — outdated)

After this commit: vault is automated, encrypted, cloud-uploaded, daily.

## Why not GitHub releases?

- Releases are not designed for 100s of MB snapshots
- Releases are tied to the repo (defeats the purpose if repo dies)
- Releases don't support client-side encryption
- Releases are public by default

S3-compatible cloud is the right primitive. Object storage, server-side replication, lifecycle policies for cheap long-term storage.
