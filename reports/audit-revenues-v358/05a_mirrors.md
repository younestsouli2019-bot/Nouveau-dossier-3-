# 05a — Activités Canal A/B/C: Doomsday Vault · Secure-Cloud · Sync Mirrors Git — Audit v3.5.8

**Règle AC-5:** Chaque canal ≥ 6 informations. Total A+B+C+D ≥ 24 data points.

---

## Canal A: Doomsday Vault (backup-doomsday-vault.ps1 · AES-256-GCM PBKDF2 1M itérations)
Total info points dans ce canal: **8**

| # | Label | Valeur | Détail | Info |
|---|-------|--------|--------|------|
| A1 | A1_script_existence | ✅ | size=5128B | script backup-doomsday-vault.ps1 existence |
| A2 | A2_env_DOOMSDAY_PHRASE_len | 0 | len=…=0 (len=5) | env:DOOMSDAY_ARCHIVE_PASSPHRASE |
| A3 | A3_keyfile_doomsday_passphrase | ⬜ | absent (file not .keys/) | .keys/doomsday-passphrase.txt size |
| A4 | A4_openssl_on_path_hint | openssl_referenced_in_script | aucune ref | ref AES-256-GCM script |
| A5 | A5_tar_on_path_hint | ✅ | ✅ tar.exe referenced | tar in script |
| A6 | A6_last_vault_ciphertext_present | ⬜ | 0 local-run vault directories found | vault dirs check |
| A7 | A7_manifest_uploads_mirrors_flags | ⬜ | uploads.presigned ok=false · uploads.supabase ok=false · mirrors.gitlab ok=false · mirrors.codeberg ok=false (mode SANS DB manifest absent) | manifest flags (4 booleans false → ok NG — aucune tentative upload détectée hors sandbox) |
| A8 | A8_roundtrip_decrypt_verify | SKIP_no_ciphertext_present_dry_run_ok | no vault ciphertext → skip roundtrip decrypt verify (sans touches fichier) | roundtrip dry run status |

---

## Canal B: Secure-Cloud Supabase (secure-cloud-upload.cmd Presigned POST + Storage Object API PUT)
Total info points: **8**

| # | Label | Valeur | Détail | Info |
|---|-------|--------|--------|------|
| B1 | B1_cmd_existence | ✅ | size=2670B | script secure-cloud-upload.cmd |
| B2 | B2_steps_count | 0 | étape curl: 0× presigned POST + Supabase Storage PUT API | 2 étapes curl attendues |
| B3 | B3_env_SUPABASE_URL | 0 | len=…=0 (len=5) | SUPABASE_URL env |
| B4 | B4_env_SUPABASE_SERVICE_ROLE_KEY | 0 | len=…=0 (len=5) | SUPABASE_SERVICE_ROLE_KEY (Bearer Auth Storage Object API) |
| B5 | B5_env_MIRROR_SUPABASE_BUCKET | 0 | len=…=0 (len=5) | MIRROR_SUPABASE_BUCKET |
| B6 | B6_env_SECURE_CLOUD_PRESIGNED_URL | 0 | len=…=0 (len=5) | fallback presigned POST mode |
| B7 | B7_logs_secure_cloud_count | 0 | 0 log files secure-cloud trouvés | logs count |
| B8 | B8_last_upload_status | SKIP_no_upload_logs_yet | pas de log upload | dernier statut |

---

## Canal C: Sync-Mirrors Git (4 remotes: GitHub · GitLab · Codeberg · Local-backup)
Total info points: **8**

| # | Label | Valeur | Détail | Info |
|---|-------|--------|--------|------|
| C1 | C1_sync_cmd_existence | ✅ | size=2370B | script sync-mirrors.cmd |
| C2 | C2_4_remotes_listed_count | 4 | 4× git push attendus: https-origin + gitlab-mirror + codeberg-mirror + local-backup | 4 remotes count |
| C3 | C3_git_remotes_configured_hint | read_simulated_from_summary | https-origin = https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git · GitLab/Codeberg/Local = env dependant | remotes list |
| C4 | C4_env_GITLAB_MIRROR_REPO | 0 | len=…=0 (len=5) | GITLAB_MIRROR_REPO |
| C5 | C5_env_GITLAB_PAT_scope_write_repo | 0 | len=…ry (len=61) | GITLAB_PAT |
| C6 | C6_env_CODEBERG_MIRROR | 0 | abse…nt (len=6) | Codeberg mirror repo env |
| C7 | C7_env_LOCAL_MIRROR_DIR | ⬜ | env LOCAL_MIRROR_DIR absent | LOCAL_MIRROR_DIR bare git |
| C8 | C8_sync_logs_count | 0 | 0 mirrors-sync.log trouvés | logs sync |

---

## Sous-total A + B + C = 24 points
