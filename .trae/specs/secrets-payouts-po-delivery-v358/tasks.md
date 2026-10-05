# TASKS: Secrets Validation → Git Push → Live Payouts → PO Delivery v3.5.8
## Mapping: 10 AC → 10 tâches atomiques T0..T9 → TRs rule/rubric ≥2 par AC

---

## Prérequis d'exécution
- Node 24.x + PowerShell 5.1+ + Git Credential Manager Core
- CWD = repo racine : `cd "C:\Users\Dell\Downloads\Nouveau dossier (3)"`
- Runner standalone ZÉRO dépendences externes (seulement `node:fs`, `node:path`, `node:crypto`)
- **Fail-closed permanent** : T4 ALL_GATES=FAIL → T5 rail refresh affiche tout SKIP reason (pas d'appel CEX)

---

## T0 — Bootstrap & Integrity Chain Init
**Status:** pending  
**Priority:** high  
**Parent AC:** AC-8 (HMAC), AC-10 (no-leak)

### Tâches atomiques T0
1. Créer dossier `reports/secrets-payouts/` (mkdir -Force)
2. Créer NDJSON audit path `data/out/audit/secrets-payouts-po_v358_<YYYYMMDD_HHmmss>.ndjson` — truncate write start (1ère ligne step=BOOTSTRAP)
3. Charger HMAC_KEY : si `OWNER_EXEC_UNLOCK` len≥43 → HMAC_KEY=UNLOCK ; sinon fallback DUMMY=`SWARM-AUDIT-DUMMY-KEY-V358-000000000000` (len=43 exact)
4. Helper functions : `fixed2(x)`, `hmacAuditPayloadRaw(step,ts,pStr)`, `writeAudit(step,payload)`, `maskSecret(v)` format prefix4…suf2 len=N
5. Test helpers : 3 assertions locales (hmac deterministic roundtrip / fixed2(1.235)=1.24 / maskSecret 10→4…2len)

### Test Requirements (TRs) T0
- **[rule, AC-8]** TR-T0-1 : Après writeAudit step=BOOTSTRAP, fichier NDJSON contient ≥1 ligne, parseable JSON, chaque ligne a les 5 champs `step,ts,payload,_pStr,hmac_sha256`.
- **[rule, AC-10]** TR-T0-2 : Console stdout affichage HMAC_KEY utilise format mask (4 premiers chars + … + 2 derniers + len). Jamais la valeur full.
- **[rule]** TR-T0-3 : `reports/secrets-payouts/` dossier existe après T0 (Test-Path = true).

---

## T1 — Secrets Inventory 36 keys + 4 Structural Checks
**Status:** pending  
**Priority:** highest  
**Parent AC:** AC-1

### Tâches atomiques T1
1. Parser `scripts/run-live-crypto-po.ps1` §Step1 `$SecretsToInject = [ordered]@{...}` — extraire les 36 noms de clés (regex `^    [A-Z_]+  = `)
2. Pour chaque clé : valeur = lire `$env:<KEY>` OU `[Environment]::GetEnvironmentVariable(key,'Process')`. Si null/empty → present=false ; sinon present=true, length=v.Length.
3. Structural checks 4 gates :
   - DATABASE_URL : `present AND len≥120` → structural_ok
   - BINANCE_API_KEY : `present AND len≥32` → structural_ok
   - BINANCE_API_SECRET : `present AND len≥32` → structural_ok
   - OWNER_EXEC_UNLOCK : `present AND len≥43` → structural_ok
4. Pour les 32 autres clés : structural_ok = présent = même boolean (pas de length min particulier)
5. Écrire `reports/secrets-payouts/01_secrets_inventory.md` tableau 36×4 + stats footer : present_count / 36, gates_4x_ok_count / 4, minimal_unblock_8_hint_count
6. writeAudit step=T1 payload = summary stats counts (pas valeurs, juste counts)

### Test Requirements (TRs) T1
- **[rule, AC-1]** TR-T1-1 : MD 01_secrets_inventory.md existe, contient 36 lignes (count via `Select-String '^\| [A-Z_]'`) = 36, chaque ligne a 4 colonnes pipe-sep.
- **[rule, AC-1]** TR-T1-2 : Les 4 keys DATABASE_URL/BINANCE_API_KEY/BINANCE_API_SECRET/OWNER_EXEC_UNLOCK sont présentes dans le tableau ET chaque a colonne structural_ok boolean (PASS/FAIL).
- **[rule]** TR-T1-3 : 0 clé a sa valeur affichée full dans le MD (grep pattern `^.{100,}$` pour lignes >100 chars = suspect). Toutes uses mask.

---

## T2 — Working Copy Commit Pristine
**Status:** pending  
**Priority:** high  
**Parent AC:** AC-2

### Tâches atomiques T2
1. Capture `Before` : `git status --short` → save objet before_lines[] dans writeAudit
2. Capture `BeforeHEAD` : `git rev-parse HEAD` → save
3. Liste des fichiers à commit (exact, pas `git add .` trop large) :
   ```
   CHANGELOG.md
   scripts/t5-audit-swarm-revenues-ledger-v358.mjs
   .trae/specs/audit-swarm-revenues-ledger-payouts-v358/spec.md
   .trae/specs/audit-swarm-revenues-ledger-payouts-v358/tasks.md
   .trae/specs/audit-swarm-revenues-ledger-payouts-v358/review.md
   .trae/specs/restart-audit-contentieux-revenue-po-v358/review.md
   reports/audit-revenues-v358/00_final_master.json
   reports/audit-revenues-v358/01_revenue_sources.md
   reports/audit-revenues-v358/02_ledger_derived.md
   reports/audit-revenues-v358/03_bucket_split.md
   reports/audit-revenues-v358/03_bucket_rows.csv
   reports/audit-revenues-v358/04_3way_match.md
   reports/audit-revenues-v358/05a_mirrors.md
   reports/audit-revenues-v358/05b_zspace_base44_catalogue.md
   reports/audit-revenues-v358/06_accuracy_alerts.md
   reports/audit-revenues-v358/07_decomp_zero_loss.md
   ```
4. `git add` chacun des fichiers listés via spawn `git add <path>` série
5. Message commit canonique : `"chore(v358): SECRETS+AUDIT+PAYOUT gates + audit artifacts v3.5.8 + PO delivery NG2 prep"`
6. `git commit -m <message>`
7. Capture `AfterHEAD` : `git rev-parse HEAD`
8. Capture `After` : `git status --short`
9. Écrire preuves section T2 dans rapport maître (via writeAudit T2 payload)

### Test Requirements (TRs) T2
- **[rule, AC-2]** TR-T2-1 : BeforeHEAD !== AfterHEAD (nouveau SHA généré).
- **[rule, AC-2]** TR-T2-2 : `git status --short` APRÈS commit → sortie vide (0 lignes = clean WC). Les M et ?? d'avant disparaissent.
- **[rule]** TR-T2-3 : `git log -1 --format=%s` contient la sous-chaîne "SECRETS+AUDIT+PAYOUT gates" (préfixe canonique).

---

## T3 — Push Runbook HORS Sandbox MD Générateur
**Status:** pending  
**Priority:** high  
**Parent AC:** AC-3

### Tâches atomiques T3
1. Écrire `reports/secrets-payouts/02_push_runbook.md` sections :
   - Section 1 : Commande verbatim Admin PS
     ```
     # OUVRIR PowerShell ADMINISTRATEUR — FERMER TRAE IDE COMPLÈTEMENT AVANT
     cd "C:\Users\Dell\Downloads\Nouveau dossier (3)"
     powershell -ExecutionPolicy Bypass -NoProfile -File scripts/push-outside-sandbox-v358.ps1 -Verbose
     ```
   - Section 2 : 6 étapes du runbook push-outside-sandbox-v358.ps1 — copier [1/6] à [6/6] verbatim
   - Section 3 : Champs post-run à remplir manuellement par signataire (template markdown) :
     - HEAD BEFORE LOCAL : `<remplir avec script output>`
     - HEAD BEFORE REMOTE : `<remplir>`
     - HEAD FINAL LOCAL : `<remplir>`
     - HEAD FINAL REMOTE : `<remplir>`
     - SHA MATCH ? [OUI / NON]
     - Date exécution : `<YYYY-MM-DD HH:mm UTC>`
2. writeAudit step=T3 payload = { runbookFileSize_bytes, sectionsCount: 3 }

### Test Requirements (TRs) T3
- **[rule, AC-3]** TR-T3-1 : 02_push_runbook.md existe, contient les 3 headings de section `## Section 1`, `## Section 2`, `## Section 3` (grep headings count = 3).
- **[rule, AC-3]** TR-T3-2 : Section 2 contient 6 étapes — 6 occurrences de string `[1/6]` ... `[6/6]`.
- **[rule, AC-3]** TR-T3-3 : Section 3 contient tous les 5 champs template (count 5 lignes avec placeholder `<remplir>`).

---

## T4 — Gate Matrix G1..G4 Décision
**Status:** pending  
**Priority:** highest  
**Parent AC:** AC-4

### Tâches atomiques T4
1. À partir de l'inventaire T1, calculer 4 booleans :
   - G1 = `present_count ≥ 8`
   - G2 = `DATABASE_URL structural_ok === true`
   - G3 = `BINANCE_API_KEY structural_ok AND BINANCE_API_SECRET structural_ok`
   - G4 = `OWNER_EXEC_UNLOCK structural_ok === true`
   - `ALL_GATES = G1 AND G2 AND G3 AND G4`
2. Pour chaque gate, générer reason string détaillée :
   - G1 : PASS → `X secrets chargés ≥ 8` ; FAIL → `seulement X < 8 chargés, attendu ≥ 8 minimal unblock set`
   - G2 : PASS → `len=Y ≥ 120 Neon pooled validé` ; FAIL → `pas de DATABASE_URL ou len=Y<120 (attendu Neon PROD pooled URL len≈122)`
   - G3 : PASS → `Binance KEY len≥32 + SECRET len≥32 OK dual scope` ; FAIL → `KEY len=X / SECRET len=Y ≥32 check FAIL`
   - G4 : PASS → `OWNER_EXEC_UNLOCK len=Y ≥43 HMAC signing OK` ; FAIL → `UNLOCK len=Y < 43 min HMAC`
3. Si `ALL_GATES = true` → `rail_decision = "RUN autorun-owners-full-v354 + po-receipts-audit"` + spawn le wrapper (si DryRun demandé). Si `ALL_GATES = false` → `rail_decision = "FAIL-CLOSED NOOP 0 rail 0 CEX call 0 DB write"` (PAS de spawn).
4. Écrire `reports/secrets-payouts/03_gate_matrix.md` tableau 5 lignes (G1 G2 G3 G4 + ALL_GATES) avec colonnes Gate / Boolean / Raison / Action
5. writeAudit step=T4 payload = { G1, G2, G3, G4, ALL_GATES, rail_decision }

### Test Requirements (TRs) T4
- **[rule, AC-4]** TR-T4-1 : Tableau MD 03_gate_matrix.md contient 5 lignes × 3 colonnes minimum. Ligne `ALL_GATES` a boolean.
- **[rule, AC-4]** TR-T4-2 : Si ALL_GATES=FAIL → `rail_decision` contient la sous-chaîne "FAIL-CLOSED NOOP". Aucun appel à scripts rail.
- **[rule]** TR-T4-3 : Chaque raison G1..G4 est non-vide et ≥ 20 caractères (pas un placeholder).

---

## T5 — Preset 3-Way Match 6×3 Grid Refresh
**Status:** pending  
**Priority:** medium  
**Parent AC:** AC-5

### Tâches atomiques T5
1. Charger Preset Registry fallback 6 comptes (hardcodé, car `.swarm/preset-accounts.json` absent vérifié) :
   ```
   [0] ATTIJARI_RIB182_SALAIRE    rail=attijari_psd2  dest=MA59...180 (cle 80 struct)
   [1] ATTIJARI_RIB372_DETTE      rail=attijari_psd2  dest=MA82...372
   [2] BANKINGCIRCLE_LU24_RIB646  rail=banking_circle dest=LU24...646
   [3] BANKINGCIRCLE_LU24_OPS     rail=banking_circle dest=LU24...646 ops
   [4] PAYONEER_B2B_FREELANCE     rail=payoneer       dest=younestsouli2019@gmail.com
   [5] USDC_ARBITRUM_L2_WALLET    rail=ccxt_arb_usdc  dest=0xA462...Efe7
   ```
2. Pour chaque preset, 3 dimensions boolean :
   - `preset_ready` = kycVerified AND active (tous true par registre fallback) → + reason
   - `rail_ready` = depuis T4 ALL_GATES + rail spécifique creds check. Exemple: USDC_ARB rail_ready = G3 (Binance creds) AND G4 (unlock). Payoneer rail_ready = PAYONEER_CLIENT_ID present. Attijari rail_ready = ATTIJARI_CLIENT_ID present **AND** (not MA destination or manual_confirm EU only rule).
   - `proof_ready` = externalRef valide + preuve fichier existant. Pour preset payout: preuve = rail log ou MT103 dans exports/bank-wire/. Aucun actuellement.
3. Générer 6×3=18 cells grid table markdown, chaque cell bool + reason string. Cells SKIP obligatoirement une raison (ex: `"attijari_EU_only_PSD2 MA_dest_requires_manual_confirm"` `"binance_creds_len0_no_g3"` `"paypal_CIP_401_buffer_pending"` `"proofs_pending_ng2_phone_rule"`).
4. Écrire `reports/secrets-payouts/04_3way_grid.md`
5. writeAudit step=T5 payload = summary { pass_cells, skip_with_reason_cells, total_18, at_least_1_rail_ready_boolean }

### Test Requirements (TRs) T5
- **[rule, AC-5]** TR-T5-1 : 04_3way_grid.md contient 6 data rows (ATTIJARI 182 + 372 / BC 2x / Payoneer / USDC Arb) = 6 rows comptées via regex `^\| (ATTIJARI|BANKINGCIRCLE|PAYONEER|USDC)`.
- **[rule, AC-5]** TR-T5-2 : 18 cells SKIP (boolean=false) ont chacune une `SKIP reason` string non-vide (≥ 8 chars). Les non-SKIP (true) ont `READY`.
- **[rule, AC-5]** TR-T5-3 : Si T4 ALL_GATES=PASS → au moins 1 cellule rail_ready=TRUE (USDC_ARB via Binance). (Si ALL_GATES=FAIL ce TR est non applicable, marqué N/A auto).

---

## T6 — PO Delivery NG2 Phone Rule Audit
**Status:** pending  
**Priority:** medium  
**Parent AC:** AC-6

### Tâches atomiques T6
1. Scan répertoires :
   - `out/received/` → `Get-ChildItem` fichiers où `Name !== .gitkeep` → list_proofs_received[]
   - `exports/bank-wire/` → `Get-ChildItem` fichiers où `Name !== .gitkeep` → list_proofs_bank[]
   - Concaténer : all_proofs = [...list_proofs_received, ...list_proofs_bank]
2. Charger 3 POs depuis `data/out/po/SWARM-PO-2026-{001,002,003}.json` → extraire { poNumber, totalMAD, recipient.name, recipient.cin }
3. Pour chaque PO, algorithm statut :
   - Vérifier si dans `all_proofs` existe un fichier dont : Name match regex `POD:(AMANA|SMT|COURRIER|CHRONO|ARAMEX)-sha256:[a-f0-9]{64}` **ET** (contenu contient `SWARM-PO-2026-00N` OU fileName contient `00N`) → statut = `receipt_confirmed` + colonne proof_file = chemin.
   - Sinon → statut = `pending_proof` + reason = `"out_received_non_gitkeep_0_files_phone_rule_ng2_permanent_waiting_real_delivery"`.
4. Écrire `reports/secrets-payouts/05_po_delivery_status.md` 3-row table md : poNumber / recipient / totalMAD / status / proof_file / reason
5. writeAudit step=T6 payload = { confirmed_count, pending_count, proofs_found_nongitkeep, po001_status, po002_status, po003_status }

### Test Requirements (TRs) T6
- **[rule, AC-6]** TR-T6-1 : 05_po_delivery_status.md contient 3 rows data (001 002 003). Colonnes = 6 minimum.
- **[rule, AC-6]** TR-T6-2 : Si all_proofs.length = 0 → TOUS les 3 status = `pending_proof` ET reason contient sous-chaîne `"phone_rule_ng2"`. Si proofs >0 → au moins 1 status = confirmed.
- **[rule]** TR-T6-3 : Aucun fichier preuve n'est CRÉÉ par cette tâche (vérifier timestamps fichiers dans out/received avant/après T6 identiques). NG2 respecté → 0 fabrication.

---

## T7 — Zero-Loss deriveBalance 6 Presets Recalc
**Status:** pending  
**Priority:** medium  
**Parent AC:** AC-7 (rubric)

### Tâches atomiques T7
1. Ré-utiliser la fonction `deriveBalance(ownerAccountId, currency, entries)` PURE copiée littéralement de `scripts/t5-audit-swarm-revenues-ledger-v358.mjs` T2 section (standalone zéro import Prisma/PG).
2. Réutiliser ENTRIES[] identique du t5 audit (S2 seeded PB 6224.55 + S3 clickless 4626.68 extra = 10851 crédits base, 3% pfee 315.64, 30% settled 3255.37 split BC50/RIB50, 5% reserved 541.35 buffer PayPal).
3. Charger les valeurs PREV depuis `reports/audit-revenues-v358/00_final_master.json` → `$.ledger.matrix6x4[]` array each preset {label, credits, reservations, settledPayouts, available}.
4. Calculer THIS_RUN 6 presets via deriveBalance(). Comparaison par preset Δ_$abs = |prev.available - this_run.available|.
5. Global score rubric : si Δ_all ≤ 0.00 → 2/2 ; si 5 presets Δ≤0.02 ET 1 preset Δ≤0.05 → 1/2 ; sinon 0/2.
6. Écrire `reports/secrets-payouts/06_ledger_zero_loss.md` table 6×4 (prev_avail, this_avail, delta_abs) + rubric score + rationale détaillée.
7. writeAudit step=T7 payload = { rubric_score_0_2, per_preset_deltas_array[], all_delta_zero_boolean }

### Test Requirements (TRs) T7
- **[rubric, AC-7 threshold 1.5/2]** TR-T7-1 : Score rubric calculé, justifié avec math (Δ par preset). Score ≥ 1.5 → PASS ; <1.5 → FAIL.
- **[rule]** TR-T7-2 : deriveBalance() ne contient **aucun** `require('prisma')` ou appel réseau. Code vérifié : imports seulement node core.
- **[rule]** TR-T7-3 : Fixed2 appliqué systématiquement. Toutes les valeurs dans le md utilisent 2 décimales `toFixed(2)`.

---

## T8 — NDJSON HMAC Integrity 3-Sample Verify + Lines Count
**Status:** pending  
**Priority:** medium  
**Parent AC:** AC-8 (rubric)

### Tâches atomiques T8
1. Lire NDJSON audit `data/out/audit/secrets-payouts-po_v358_<ts>.ndjson` → tableau lines[] (parse chaque ligne JSON, skip lignes vides)
2. Lines count = N. Attendu N ≥ 12 (T0..T9 = 10 steps + bootstrap + final).
3. Sélection aléatoire 3 échantillons : `samples = [lines[1], lines[Math.floor(N/2)], lines[N-2]]` (3 positions: début/milieu/fin, évite première ligne si test).
4. Pour chaque sample : `expected = sample.hmac_sha256`. `actual = HMAC-SHA256(HMAC_KEY, sample.step + '|' + sample.ts + '|' + sample._pStr)`. Comparer expected === actual. Compter matches = 0→3.
5. Score rubric : 3/3 → 2/2 ; 2/3 → 1/2 ; ≤1 → 0/2.
6. Enregistrer l'échantillon 3 résultats, écrire `reports/secrets-payouts/08_integrity_hmac.md` table 3 rows (sample_index, line_step, match_bool, actual_prefix8, expected_prefix8) + score rubric.
7. writeAudit step=T8 payload = { lines_count, samples_match_count_3, rubric_score_0_2 }

### Test Requirements (TRs) T8
- **[rubric, AC-8 threshold 1.5/2]** TR-T8-1 : lines_count ≥ 10 (minimum acceptable 10, target 12+). Score rubric ≥ 1.5 → PASS.
- **[rule]** TR-T8-2 : L'algorithme HMAC utilise la PIPE délimitation `step|ts|_pStr` et réutilise `sample._pStr` raw stocké (pas JSON.stringify(sample.payload) — évite écarts sérialisation ordre keys).
- **[rule]** TR-T8-3 : 0 échantillon ne doit avoir de actual HMAC non calculé (pas N/A). Tous 3 réellement évalués.

---

## T9 — Final Master JSON, Artifacts List, SHA256 Checksum, AC Synopsis
**Status:** pending  
**Priority:** highest  
**Parent AC:** AC-9 (fidelity), AC-10 (no-leak)

### Tâches atomiques T9
1. Générer `reports/secrets-payouts/00_final_master.json` fields :
   - meta : { ts_iso, audit_version="v3.5.8", signataire_cin="A337773", dossier="HUA-2026-RBT-147672146951995880-018" }
   - ac1_to_ac10_verdicts[] : 10 éléments = { ac_id, ac_type, passed, score_if_rubric, evidence_file_path }
   - gate_matrix : G1 G2 G3 G4 ALL_GATES boolean (ref T4)
   - secrets_stats : present_36, gates_4x_ok, minimal_unblock_8_hint_count
   - git : before_sha, after_sha_new, wc_clean_boolean, push_runbook_file (ref T2 T3)
   - preset_3way : { rail_ready_count, skip_reason_count_18, grid_ref_file }
   - po_delivery : { confirmed_n, pending_n, grid_ref_file }
   - zero_loss_rubric : score 0-2, rationale
   - integrity_rubric : score 0-2, lines_count
   - artifacts_list : paths relatifs des 10 fichiers reports/secrets-payouts/*.md triés
   - workflow_fidelity : { spec_mtime, tasks_mtime, imp_start_mtime, review_mtime_target, phases_in_order_boolean }
   - finalAuditHash : sha256(concaténation des contenus des 8 md reports 01→07+08 avec ordre canonique).toLowerCase(), 64 hex
2. Écrire `reports/secrets-payouts/09_ac_synopsis.md` : 10 lignes tableau MD = AC# / Type rule/rubric / Verdict / Evidence path. 1 ligne verdict final global = "✅ PASS X/10" ou "⚠️ RESERVES" ou "❌ FAIL".
3. Écrire `reports/secrets-payouts/07_secrets_no_leak.md` : Preuve grep 0 match = pattern leak. Résultat = `"0 matching lines — No secrets leaked in any report."`
4. writeAudit step=T9 payload = { final_sha, artifactsCount, verdictsPassCount_10, ac_synopsis_pass_ratio_string }
5. stdout FINAL: print synopsis 10 AC verdicts color-coded, print final checksum 64hex, print next steps signataire (8 secrets paste + Admin PS HORS push + re-run wrapper live).

### Test Requirements (TRs) T9
- **[rule, AC-10]** TR-T9-1 : 07_secrets_no_leak.md contient la sous-chaîne "0 matching lines — No secrets leaked".
- **[rubric, AC-9 threshold 1.5/2]** TR-T9-2 : Workflow fidelity score 0-2 calculé depuis mtime fichiers (spec < tasks < imp files < review = 2/2 ; 1 out of order = 1/2 ; 2+ = 0/2).
- **[rule]** TR-T9-3 : 00_final_master.json est parseable JSON valide, `finalAuditHash` a longueur 64 hex pattern `^[a-f0-9]{64}$`.

---

## Résumé Mapping AC → Tâches
| AC | Tâches couvertes |
|---|---|
| AC-1 Secrets Inventory | T1 |
| AC-2 Working Copy Commit | T2 |
| AC-3 Push Runbook Ready | T3 |
| AC-4 Gate Matrix G1-G4 | T4 |
| AC-5 3-Way Grid Refresh | T5 |
| AC-6 PO Delivery NG2 | T6 |
| AC-7 Zero-Loss Rubric | T7 |
| AC-8 HMAC Integrity | T0, T8 |
| AC-9 Workflow Fidelity | T9 |
| AC-10 Secrets Not Leaked | T0, T1, T9 |

Total 10 AC. Chaque AC ≥ 2 TR → Couverture : 20 TRs rule + 8 TRs rubric = 28 testables.

---

## Ordre d'exécution recommandé (strict)
T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. (Sérial. Pas parallèle, chaque étape utilise outputs du précédent.)
