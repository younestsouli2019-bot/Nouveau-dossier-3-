# Sync Backups to swarm Repo

Steps to sync backups into [CoNrAd2525/swarm](https://github.com/CoNrAd2525/swarm)

1) Create a fresh snapshot locally
- node scripts/backup-project-state.mjs

1) Copy the newest snapshot folder into the swarm repo
- Clone [CoNrAd2525/swarm](https://github.com/CoNrAd2525/swarm)
- Create a folder inside it:
  backups/realworldcerts/
- Copy:
  backups/snapshot_YYYY-MM-DDTHH-mm-ss-sssZ/
  into:
  CoNrAd2525/swarm/backups/realworldcerts/snapshot_YYYY-MM-DDTHH-mm-ss-sssZ/

1) Commit and push from that swarm repo
- git add -A
- git commit -m "backup: realworldcerts snapshot"
- git push

## Notes
- This repo contains many local-only secrets and large artifacts. Only copy the snapshot folder contents, not the whole workspace.
- The snapshot manifest.json lists exactly what was captured for restore.
