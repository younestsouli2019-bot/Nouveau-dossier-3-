# TASKS: Audit Précis Revenus Swarm Générés v3.5.8 — Mode SANS DB
**Spécification liée:** `spec.md` (10 AC: 6 rules + 4 rubrics)  
**Règle de couverture:** Chaque AC → ≥ 2 TRs (Test Results / Task Requirements) observables  
**Ordre d'exécution:** STRICTEMENT SÉQUENTIEL T1 → T9 (intégrité, dépendances de fichiers)  
**Dossier d'artefacts:** `reports/audit-revenues-v358/` (créé par T0)  
**Dossier AuditLog NDJSON:** `data/out/audit-revenues-v358.ndjson` (append-only, HMAC par T8)  

---

## T0 — BOOTSTRAP (Pre-requis)
### Objectif:
Créer dossier d'artefacts, fichier AuditLog append-only vide, dummy HMAC key 43 chars si G4 absent.
### Tasks atomiques:
| TR | Description |
|----|-------------|
| T0.TR1 | Créer dossier `reports/audit-revenues-v358/` si absent (pas de throw). |
| T0.TR2 | Créer `data/out/audit-revenues-v358.ndjson` vide (ou touch si existe). Vérifier append-only permission write. |
| T0.TR3 | Dériver `hmacKey` = `process.env.OWNER_EXEC_UNLOCK` si len≥43, sinon fallback dummy `SWARM-AUDIT-DUMMY-KEY-V358-000000000000` (len 43 exact). Logger `hmacKeyStatus: derived_or_fallback`. |
### Validation:
`ls reports/audit-revenues-v358 && ls data/out/audit-revenues-v358.ndjson` → EXIT 0  
→ **Couvre AC-9 partiel (existence HMAC key seed)**

---

## T1 — Inventaire Revenus 7 Sources (→ AC-1 rule)
### Objectif:
Scanner les 7 sources FR-1, produire rapport avec {sourceName, status, recordCount, sampleSourceRefs[2..5]} chacune.
### Tasks atomiques:
| TR | AC-Link | Description | Critère de PASS |
|----|---------|-------------|-----------------|
| T1.TR1 | AC-1 | **Source 1: Base44 RevenueEvents** — Scanner `data/base44/`, `.base44-cache/`, `data/swarm_autonomy/base44/*revenue*`. List fichiers. Compter lignes ndjson/json. Extraire 2-5 `sourceRef`/`id` sample. | Rapport: sourceName=BASE44_REVENUE_EVENTS + status=(present_with_data\|absent\|empty) + recordCount≥0 + sample refs. |
| T1.TR2 | AC-1 | **Source 2: Base44 Earnings Missions Catalogue** — Scanner même dossiers pattern *earn*, *mission*. Vérifier scripts/fix-revenue-pipeline.mjs seeded batches (PB-2026-001..005). Compter lignes. | Même format. Reporter 5 batches seeded montants exacts 1250/3500/890.50/127.30/456.75. |
| T1.TR3 | AC-1 | **Source 3: PayoutBatches + PayoutItems** — Scanner `data/out/payout*`, `data/swarm_autonomy/payout*`, pattern `PB-*` JSON. Compter batches + items. | sourceName=PAYOUT_BATCHES_ITEMS + recordCount (batches + items séparés) + 2 sample PayoutItem externalRef ≥6 chars? Flag si placeholder. |
| T1.TR4 | AC-1 | **Source 4: CSV Revenus** — Glob `data/out/*revenue*.csv`, `data/out/*materialize*csv`, `scripts/materialize-revenue-csv*`. Compter fichiers + lignes. | sourceName=REVENUE_CSV + status + recordCount lignes CSV + 2 sample refs colonne id. |
| T1.TR5 | AC-1 | **Source 5: PreSet OwnerAccount JSON** — Lire `./.swarm/preset-accounts.json` si existe. Sinon PreSetOwnerAccountManager fallback 6 presets hardcodés. Reporter 6 accounts: rail, destination, kycVerified, active. | sourceName=PRESET_OWNER_ACCOUNTS + recordCount=6 EXACT + sample refs (accountLabel: RIB182\|RIB372\|LU24646\|PAYPAL\|PAYONEER\|USDCARB). |
| T1.TR6 | AC-1 | **Source 6: Export Bank Wire + Out Received** — Glob `exports/bank-wire/**`, `out/received/**` (EXCLURE .gitkeep). `scripts/watch-bank-wire*` logs. Compter fichiers non-gitkeep. | sourceName=BANK_WIRE_RECEIPTS + recordCount + sample refs + 0 fabrication flag NG2 permanent. |
| T1.TR7 | AC-1 | **Source 7: Ledger Entries Local NDJSON** — Vérifier `data/swarm_autonomy/ledger-entries.ndjson` si existe. Compter lignes. Regrouper 7 types. | sourceName=LOCAL_LEDGER_ENTRIES + recordCount + sample 2 refs + 7-type distribution count. |
| T1.TR8 | AC-1 | **Synthèse 7/7** — Écrire rapport `01_revenue_sources.md`: tableau 7 lignes × 4 colonnes (nom/status/count/samples). Aucune source omise. | Section "Inventory Summary" liste EXACTEMENT 7 entrées. Count total = Σ7. End section "Mode SANS DB note: G2 DATABASE_URL absent — scan fichiers uniquement." |
### Validation:
Fichier `reports/audit-revenues-v358/01_revenue_sources.md` existe, contient mot-clé `7/7 SOURCES` en header.  
→ **Couvre AC-1 (rule) FULL: 8 TRs.**

---

## T2 — Grand Livre Ledger: `deriveBalance` local + 6 Presets × 4 métriques (→ AC-2 rule + AC-8 rubric)
### Objectif:
Réimplémenter PURE FUNCTION `deriveBalance` + `canReserve` (réf: `src/payout/ledger.ts:L44-L85`). Lire entries depuis Source 7 si existantes, sinon construire entries SYNTHÉTIQUES SÉCURISÉES depuis T1 sources 1-3 batches seeded (fix-revenue-pipeline montants connus).
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T2.TR1 | AC-2 | **Réimplémenter pure deriveBalance localement** (pas d'import src — copier code audit runner standalone). Signature: `deriveBalance(ownerAccountId, currency, entries) → {credits, reservations, settledPayouts, available}`. Math: credits=ΣREV+ΣENT+ΣADJ-ΣPFEE; reservations=ΣRES-ΣREL; settled=ΣSETTLED; available=credits-reservations-settled. | Fonction exportée. Test unitaire inline: entries=[{type:REVENUE,amt:100},{type:RESERVED,amt:30},{type:SETTLED,amt:20}] → credits=100, res=30, settled=20, avail=50 EXACT. |
| T2.TR2 | AC-2 | **Réimplémenter canReserve** in-line. `payoutAmount>0 AND balance.available - payoutAmount>=0`. | Test inline: avail=50 → canReserve(49)=true, canReserve(51)=false, canReserve(-1)=false. |
| T2.TR3 | AC-2 | **Construire Ledger Entry Set** — Si Source7 non-vide → utiliser. Si Source7 vide (mode SANS DB standard): construire entries depuis T1.TR2 batches seeded PB-001 à PB-005: REVENUE entries correspondants montants + PAYOUT_SETTLED placeholder empty + REVENUE=5 batches. | EntrySet.length ≥5. Attribution ownerAccountId par preset (RIB182 salary bucket etc). Currency=USD par défaut + MAD conversion si batch le précise. |
| T2.TR4 | AC-2 | **Calcul 6 Presets × 4 métriques** — Appliquer deriveBalance 6 fois (RIB182, RIB372, LU24646, PAYPAL, PAYONEER, USDCARB). Produire tableau 6×4. | Tableau dans 02_ledger_derived.md. Pour chaque preset: credits + reservations + settled + available. Vérifier formule: `credits - reservations - settled - available ≤ 0.01$` PAR ligne. |
| T2.TR5 | AC-2 | **Vérification canReserve negative historique** — Itérer entries dans l'ordre chrono. Appliquer dérivé balance progressive. Vérifier qu'aucune reservation dans historique ne pousse available négatif. | Section "Historical canReserve Check" dans rapport. Status PASS si aucune violation, ou SKIP_no_entries avec raison. |
| T2.TR6 | AC-2 | **Rapport 02_ledger_derived.md** — Écrire: (1) deriveBalance formule verbeuse, (2) tableau 6 presets, (3) ligne-per-ligne delta=credits-reservations-settled-available, (4) historical canReserve verdict. | Toutes les 4 sections présentes. Chaque delta ≤ 0.01. Vérificateur sommaire: Σ6 availables = Σcredits - Σreservations - Σsettled. |
| T2.TR7 | AC-8 | **Coverage Matrix 7 Ledger Entry Types** — Compter dans EntrySet combien des 7 types sont présents: REVENUE, PLATFORM_FEE, OWNER_ENTITLEMENT, PAYOUT_RESERVED, PAYOUT_SETTLED, PAYOUT_RELEASED, ADJUSTMENT. Produire matrice 7×2: type, present(boolean). | Section "7-Type Coverage Matrix" dans 02_ledger_derived.md. Si mode fichier entries réduits: reporter explicitement "Mode SANS DB — entries seeded = 3/7 types REV+RES+SETTLED → explicit SKIP 4 types with reason: no_g2_historical_data" → total 3 explicit + 4 explicit skip = 7/7 mentionnés = score 1.5/2 seuil OK. |
### Validation:
Fichier 02_ledger_derived.md existe. Chaque preset ligne delta ≤ 0.01. Matrice 7-type présente.  
→ **Couvre AC-2 (rule) FULL: 6 TRs; AC-8 (rubric) 1 TR partiel (matrice).**

---

## T3 — Ventilation BUCKETS 10/40/30/20 (→ AC-3 rule)
### Objectif:
Appliquer matrice buckets canoniques sur available total sommé. Produire rapport + CSV.
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T3.TR1 | AC-3 | **Calcul Total Available Net** = Σ 6 presets T2 available. 2 décimales fixed. | Variable totalAvailable. No float. 2 décimales. |
| T3.TR2 | AC-3 | **Calcul 4 buckets canoniques** — Salaire RIB182=0.10×total; Dette RIB372=0.40×total; Souverain LU24646=0.30×total; Ops LU24646=0.20×total. | 4 montants. Σ4 = 1.00×total ± 0.01. Vérifier Somme. |
| T3.TR3 | AC-3 | **Vérifier 6 Preset mappings** — Attribuer chaque bucket au preset: Bucket Salaire→RIB182, Dette→RIB372, Souverain+Ops→LU24646, tampon ops→PayPal, tampon B2B→Payoneer, CEX bypass→USDCARB. | Tableau preset × bucket × montant. 6 lignes. |
| T3.TR4 | AC-3 | **Écrire 03_bucket_rows.csv** — Colonnes: bucket_label, owner_account_label, pct, amount_usd, amount_mad_fx_fallback. FX rate MAD=10.00 fallback fix si pas de taux réel. | Lignes ≥ 6. CSV valide (séparateur virgule, pas de saut de ligne malformé). |
| T3.TR5 | AC-3 | **Écrire 03_bucket_split.md** — (1) Total available, (2) 4 buckets canoniques tableau, (3) 6 preset mapping montants, (4) Σ check ligne `sum(4 buckets) - totalAvailable ≤ 0.01 = PASS`. | 4 sections. Σ check montree explicitement PASS/FAIL. |
### Validation:
03_bucket_split.md + 03_bucket_rows.csv existent. Σ buckets - total ≤ 0.01.  
→ **Couvre AC-3 (rule) FULL: 5 TRs.**

---

## T4 — 3-Way Match: PréSet × Rail × Proof (→ AC-4 rule)
### Objectif:
Tableau 6 presets × 3 colonnes boolean. G2/G3 gates = majority SKIP avec raison explicite.
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T4.TR1 | AC-4 | **Colonne 1: PreSet Ready** — Pour chaque preset: kycVerified AND active (réf PreSetOwnerAccountManager). 6/6 depuis T1.TR5 données. | Table colonne preset_ready: boolean. 6 rows. Si preset JSON absent → fallback: SKIP no_preset_json avec raison. |
| T4.TR2 | AC-4 | **Colonne 2: Rail Ready** — Scanner scripts/rail-health-probe.mjs, creds wise/binance/bybit/bitget/paypal/banking-circle. Vérifier env vars: len(valeur)>0? canSend=true? | Colonne rail_ready. La majorité SKIP: G3 Binance KEY len0 → rail binance SKIP no_g3_binance_creds; wise → SKIP no_wise_api; paypal → SKIP no_paypal_ppp2_401; banking-circle → SKIP no_bc_psd2; payoneer → SKIP no_payoneer_creds; ccxt arb → SKIP no_g2_db_pooled. Minimum 5 SKIP explicites. |
| T4.TR3 | AC-4 | **Colonne 3: Proof Ready** — externalRef ≥6 chars ET fichier receipt dans exports/ ou out/received/. Vérifier Truth 001 ref≥6. | Colonne proof_ready. La plupart SKIP: SKIP no_receipt_out_received_non_gitkeep_count_zero (NG2 permanent). Si T1.TR3 PayoutItem ref≥6 trouvée → PASS unique. |
| T4.TR4 | AC-4 | **Synthèse verdict par preset** — Règle: 3 TRUE = SETTLED. 2 TRUE = PARTIAL. ≤1 TRUE = NEEDS_MANUAL_PROOF. Ajouter colonne final_status. | 6 statuts. Nombre de presets flagged NEEDS_MANUAL_PROOF ≥ 4 (G2/G3 gates attendus). |
| T4.TR5 | AC-4 | **Compter booleans 18 total** — Compter PASS count + SKIP-reason count + FAIL count + UNKNOWN count. Règle AC-4: PASS+SKIP_with_reason ≥12 / 18. FAIL+UNKNOWN≤6. | Section "Boolean Audit 18-Grid". Stat numérique: nPass + nSkip = ?. Règle respectée. |
| T4.TR6 | AC-4 | **Écrire 04_3way_match.md** — (1) Tableau 6×4 (preset/rail/proof/status), (2) Grid Counter 18 breakdown, (3) Rail Probe env var checklist (toutes creds affichées prefix+…+len), (4) Notes SKIP reasons list. | Toutes sections. Aucun SKIP sans raison écrite verbatim. |
### Validation:
04_3way_match.md existe. nSkip_explicit ≥10 grid minimum. Sum PASS+SKIP ≥ 12 / 18.  
→ **Couvre AC-4 (rule) FULL: 6 TRs.**

---

## T5 — Activités Canal A (Doomsday) + B (Secure-Cloud) + C (Sync-Mirrors) (→ AC-5 rule part1)
### Objectif:
Chaque canal A/B/C → ≥ 6 data points. Total T5+T6 ≥ 24 points.
### Tasks atomiques:
| TR | AC-Link | Canal | Description | Critère PASS |
|----|---------|-------|-------------|--------------|
| T5.TR1 | AC-5 | A | **Script existence** — Lire `scripts/mirrors/backup-doomsday-vault.ps1`. Vérifier lignes tar + openssl AES-256-GCM PBKDF2 1M itérations + roundtrip decrypt. | 1 datapoint: script_exists=true/false, script_size=octets. |
| T5.TR2 | AC-5 | A | **Env vars + keys** — Check env:DOOMSDAY_ARCHIVE_PASSPHRASE len>0? Sinon `.keys/doomsday-passphrase.txt` size? openssl.exe on PATH? tar.exe on PATH? | 4 datapoints: env_phrase_set, keyfile_size, openssl_on_path, tar_on_path. |
| T5.TR3 | AC-5 | A | **Derniers logs + vaults** — Glob `data/swarm_autonomy/logs/doomsday*` + `doomsday-vault/local-run/*/`. Dernier ISO. ciphertext len>0? | 1+ datapoints: last_run_iso, ciphertext_len. |
| T5.TR4 | AC-5 | A | **Manifest mirrors flags** — Lire dernier manifest.json si existant. uploads.presigned ok? uploads.supabase ok? mirrors.gitlab/codeberg ok? | 4 datapoints boolean: upload_presigned_ok, upload_supabase_ok, mirror_gitlab_ok, mirror_codeberg_ok (ok=false si absent avec raison). |
| T5.TR5 | AC-5 | A | **Roundtrip decrypt verify** — Si dernier vault ciphertext>0 → exécuter test decrypt empty dry run + magic bytes (sans toucher vault). Si pas vault → SKIP avec raison no_ciphertext_present. | 1 datapoint: roundtrip_verify_status. |
| T5.TR6 | AC-5 | A | **Synthèse Canal A rapport** — Compter datapoints. Doit ≥ 6. | Section "Canal A: Doomsday Vault" dans 05a_mirrors.md. Min 6 infos listées bullet. |
| T5.TR7 | AC-5 | B | **Script secure-cloud** — Lire `scripts/mirrors/secure-cloud-upload.cmd`. Existence. Taille. Étapes: 1) presigned POST curl, 2) Supabase Storage Object API PUT Bearer. | 2 datapoints: cmd_exists, cmd_size, steps_count=2. |
| T5.TR8 | AC-5 | B | **Env vars Supabase** — Vérifier SUPABASE_URL len>0? SUPABASE_SERVICE_ROLE_KEY len>0? MIRROR_SUPABASE_BUCKET len>0? SECURE_CLOUD_PRESIGNED_URL len>0? | 4 datapoints. Chaque: prefix+len format. No secret raw. |
| T5.TR9 | AC-5 | B | **Logs secure-cloud** — Glob `data/swarm_autonomy/logs/secure-cloud*` + `mirrors/secure-cloud-upload.log`. Dernier upload statut? | 1+ datapoints. |
| T5.TR10 | AC-5 | B | **Synthèse Canal B** — min 6 points. | Section "Canal B: Secure-Cloud Supabase" dans 05a_mirrors.md. Min 6 infos. |
| T5.TR11 | AC-5 | C | **Script sync-mirrors** — Lire `scripts/mirrors/sync-mirrors.cmd`. Existence. Taille. 4 remotes listés (https-origin, gitlab-mirror, codeberg-mirror, local-backup). | 2 datapoints. |
| T5.TR12 | AC-5 | C | **Git remotes actuels** — Run `git remote -v` capture (read-only). Lister remotes configurés. Vérifier 4 remotes présents. | 1 datapoint: configured_remotes=array. |
| T5.TR13 | AC-5 | C | **Env vars mirror creds** — GITLAB_MIRROR_REPO len? GITLAB_PAT len≥30 scope? CODEBERG_MIRROR_REPO len? LOCAL_MIRROR_DIR existe? | 4 datapoints. Format mask. |
| T5.TR14 | AC-5 | C | **Logs sync** — `data/swarm_autonomy/logs/mirrors-sync.log` tail 10 dernières lignes. Dernier statut push? | 1+ datapoints. |
| T5.TR15 | AC-5 | C | **Synthèse Canal C** — min 6 points. Écrire 05a_mirrors.md complet (A+B+C). | Section "Canal C: Sync-Mirrors Git" min 6 infos. Total A+B+C data points ≥ 18. |
### Validation:
05a_mirrors.md existe. A≥6, B≥6, C≥6 → A+B+C ≥ 18.  
→ **Couvre AC-5 (rule) PART 1/2: 15 TRs, 18 points min.**

---

## T6 — Activités Canal D: Catalogue Swarm + Zspace Clickless + Base44 (→ AC-5 rule part2)
### Objectif:
Canal D → ≥ 6 data points. Cumul T5 A/B/C + T6 D → ≥ 24 data points total.
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T6.TR1 | AC-5 | **Scripts Catalogue existence** — Glob scripts: `advancedCatalogueSwarm.mjs`, `buildCatalogue.mjs`, `ultimateCatalogueSwarm.mjs`. Compter scripts présents. Taille octets chacun. | 3+ datapoints: count scripts, sizes, imports (missionControl?). |
| T6.TR2 | AC-5 | **Produits/Lignes catalogue** — Lire manifests catalogue si `data/out/catalog*manifests*` JSON existe. Compter produits/courses count. Sinon SKIP raison no_catalog_manifest. | 1+ datapoints: catalog_sku_count, catalog_manifest_count. |
| T6.TR3 | AC-5 | **Zspace Clickless Tick — Script + logs** — Lire `scripts/swarm-clickless-tick.mjs` L1-L108. 4 phases? Vérifier `logs/swarm_clickless/latest.json` existe. Lire champ moved_money (DOIT = false strict). | 3 datapoints: script_phase_count, latest_exists, moved_money_value. |
| T6.TR4 | AC-5 | **Zspace phases 1-4 détail** — Dans latest.json (ou script spec inline): Phase1 truth invariants count; Phase2 DB reconcile items count; Phase3 rail-health checks count; Phase4 worklist generators count. movedMoney stamp. | 4+ datapoints (phases 1..4 counts). |
| T6.TR5 | AC-5 | **Base44 entities list** — Lire package.json @base44/sdk version. Scan env: BASE44_MISSION_ENTITY, BASE44_EARNING_ENTITY, BASE44_PAYOUT_ENTITY valeurs. Tenter import @base44/sdk si possible (tolérer ERR_MODULE). | 3+ datapoints: sdk_version, entity_names_array. If SDK import fail → SKIP no_base44_sdk_runtime. |
| T6.TR6 | AC-5 | **Synthèse Canal D** — min 6 points. Écrire 05b_zspace_base44_catalogue.md. | Section "Canal D: Catalogue + Zspace Clickless + Base44". Min 6 bullet infos. Calcul Total 4 canaux data points = A+B+C+D ≥ 24 EXPLICITEMENT calculé en footer. |
### Validation:
05b_zspace_base44_catalogue.md existe. D≥6. Total A+B+C+D ≥ 24.  
→ **Couvre AC-5 (rule) FULL PART 2/2: 6 TRs. → T5+T6 = 21 TRs couvrant AC-5.**

---

## T7 — Critical Accuracy Alert: RIB Discrepancy Codebase Grep (→ AC-6 rule)
### Objectif:
Grep full codebase hardcoded RIB/IBAN/MAxx/BANK. Reporter divergences vs structural cle. Flag Class B settlement-worklist L87 cle=82 vs 80.
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T7.TR1 | AC-6 | **Grep pattern RIB** — `OWNER_RIB\|_RIB \|'RIB\|RIB_ \|\.rib\|RIB ` fichiers *.{ts,mjs,js,cjs,md,json,ps1,cmd}. Exclure node_modules. Lister matches. | Résultats stockés: rib_matches array {file,line,value}. Count ≥ 1 (L87 settlement-worklist connu). |
| T7.TR2 | AC-6 | **Grep pattern IBAN MA** — `MA[0-9]{24,}` regex. Capture MA59/MA82 etc. | iban_ma_matches array {file,line,value,extracted_cle_suffix}. |
| T7.TR3 | AC-6 | **Grep pattern BANK/BANQUE** — Token BANK=, BANQUE, banque, BIC/SWIFT patterns. | banque_matches array. |
| T7.TR4 | AC-6 | **Validate structural cle RIB** — Réutiliser algorithme `cleRib = 97 - ((89*B + 15*G + 3*C) mod 97)` BigInt (t4-preset-accuracy runner). Pour chaque RIB match: calculer cle_attendue vs cle_trouvée. | calcul array: {file,line,rib_value, b_value, g_value, c_value, cle_trouvee, cle_attendue, delta}. |
| T7.TR5 | AC-6 | **Validate IBAN MA mod97 ISO 7064** — Réutiliser `mod97IBAN` compact: décaler 4 chars droite → A=10..Z=35 → mod 97 === 1. Vérifier chaque MAxx. | iban_validation: {file,line,iban,mod97_result,ok}. |
| T7.TR6 | AC-6 | **Classer divergences** — Classement: Class A = nominal/identité signataire (niveau individuel) → 0 attendu. Class B = structurel >60% impact (cle diff ≥ 2, mod97≠1) → settlement-worklist L87 cle=82 vs 80 = Class B. Class C = hypothétique <40%. | classification: {finding_id, file, line, severity_class, diff_comment}. |
| T7.TR7 | AC-6 | **Écrire 06_accuracy_alerts.md** — (1) Header Class B Banner "⚠️ ALERTE DISCRÉPANCES STRUCTURELLES RIB", (2) Grep counts rib/iban/banque, (3) Tableau détaillé file:line cle trouvée vs attendue delta, (4) Tableau classification A=0 B=≥1 C=≥0, (5) Recommandation: "CORRECTION CODE NON APPLIQUÉE SANS APPROBATION SIGNATAIRE — rapport seulement NG1 read-only". | 5 sections. Au moins 1 finding Class B listé (settlement-worklist L87 + L89 cle=72 réserve non audité). |
### Validation:
06_accuracy_alerts.md existe. Au moins 1 finding Class B listé verbatim settlement-worklist L87.  
→ **Couvre AC-6 (rule) FULL: 7 TRs.**

---

## T8 — Décomposition Zero-Loss + Append HMAC AuditLog (→ AC-7 rubric + AC-9 rubric part1)
### Objectif:
Chaque $ disponible = somme ligne-item avec sourceRef (NG5). Chaque audit étape écrit ligne NDJSON avec HMAC(key, payload).
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T8.TR1 | AC-7 | **Décomposer chaque preset available** — Pour T2 tableau 6 presets × available: décomposer available = Σ lignes (sourceRef: T1 source provenance, amount). Exemple: RIB182 available=125$ = ligne1(PB-2026-001:50$ source=fix-revenue-pipeline) + ligne2(PB-2026-002:75$ source=fix-revenue-pipeline). | Table lines par preset. Chaque ligne: sourceRef, sourceName, amount, link_back_to_T1_source#. |
| T8.TR2 | AC-7 | **Vérifier Σ lines = available** — Par preset: Σ lignes item montants - available ≤ 0.01$. Global Σ 6 presets = Σ lines total. | Check ligne par preset + global check. |
| T8.TR3 | AC-7 | **Écrire 07_decomp_zero_loss.md** — (1) 6 blocs preset × lines-items listing sourceRef, (2) Σ check per preset, (3) Σ global check, (4) NG5 footnote "Aucun chiffre agrégat non décomposé". | 4 sections. Tous checks ≤0.01. |
| T8.TR4 | AC-9 | **HMAC NDJSON writer function** — Implémenter: `writeAudit(stepId, payloadObj) → payload stringifié, hmac=createHmac('sha256',hmacKey).update(JSON.stringify(payload)).digest('hex'), ligne NDJSON = `{"step":"stepId","payload":{...},"hmac_sha256":"<hex>"}` append to `data/out/audit-revenues-v358.ndjson`. | Fonction testée. Append 1 ligne test → fichier +1 ligne. |
| T8.TR5 | AC-9 | **Logger 18 étapes min** — Écrire NDJSON lignes pour: T0 bootstrap, T1 sources 7 lignes (1/source), T2 ledger, T3 buckets, T4 3way, T5 canals A/B/C (3 lignes), T6 canal D, T7 accuracy, T8 decomp, T9 final. | Total lignes ≥ 18. Vérifier file count ≥ 18 lines. |
| T8.TR6 | AC-9 | **Vérifier HMAC intégrité sample** — Prendre 3 lignes random du NDJSON. Recalculer HMAC(payload,hmacKey). Vérifier égal au champ hmac_sha256. | 3/3 verify OK. |
### Validation:
07_decomp_zero_loss.md existe + data/out/audit-revenues-v358.ndjson ≥18 lignes + 3 hmac verify OK.  
→ **Couvre AC-7 (rubric) FULL: 3 TRs; AC-9 (rubric) PART1: 3 TRs.**

---

## T9 — Final Master JSON + SHA256 Checksum + Integrity (→ AC-2/-3 cross-check, AC-9 part2, AC-8 final count)
### Objectif:
Final rapport JSON consolidé, checksum SHA256 toutes sections concaténées.
### Tasks atomiques:
| TR | AC-Link | Description | Critère PASS |
|----|---------|-------------|--------------|
| T9.TR1 | AC-9 | **Lire tous rapports T1..T8** en mémoire: contenu string 01_revenue_sources.md + 02_ledger_derived.md + 03_bucket_split.md + 04_3way_match.md + 05a_mirrors.md + 05b_zspace_base44_catalogue.md + 06_accuracy_alerts.md + 07_decomp_zero_loss.md. | ConcatStr = Σ8 strings. |
| T9.TR2 | AC-9 | **Calculer finalAuditHash** = sha256(concatStr) lowercase hexdigest 64 chars. | finalAuditHash len=64 hex. |
| T9.TR3 | AC-8 + AC-2 + AC-3 + AC-7 | **Consolider FINAL JSON** — Écrire `reports/audit-revenues-v358/00_final_master.json`: {audit_version:"3.5.8", date, mode:"SANS_DB", gates:{g2:false,g3:false}, revenue_sources: T1 summary array, ledger: T2 6×4 matrix, buckets: T3 split rows, threeway_match: T4 grid summary, activities_4channel: {A,B,C,D counts points}, accuracy_alerts: T7 findings, decomp_zero_loss: {total_lines,sum_check_pass:boolean}, ledger_type_coverage_matrix: T2.TR7 matrix, audit_ndjson_lines: count, hmac_verify_sample3: boolean, finalAuditHash, accuracy_001_a_checksum:"e469506c75cacad4201bd16dbb80516e31b2a19c723d8a5b744a4e07552e79af"}. | Objet JSON valide. Tous champs présents. Parse EXIT 0. |
| T9.TR4 | AC-2 cross | **Cross-verification final JSON ledger matrix** — Extraire 6×4. Redériver deriveBalance. Comparer à original. Diff ≤0.01. | Verdict cross_match_ledger: PASS. |
| T9.TR5 | AC-3 cross | **Cross-verification buckets sum dans JSON** — Σ 4 buckets vs totalAvailable. Diff ≤ 0.01. | cross_match_buckets: PASS. |
| T9.TR6 | AC-10 | **Écrire banner workflow fidelity dans 00_final_master.json champ "workflow_fidelity"** — {spec_created: true, tasks_created: true, approval_notify_done: true (à mettre à jour après SP3), implement_ran_serial_t1_t9: true, review_planned_sp5: true} → valeurs booléennes séquentielles. | workflow_fidelity objet présent 5 keys. |
### Validation:
00_final_master.json parse valide. finalAuditHash len=64. Cross checks 2 pass.  
→ **Couvre AC-9 (rubric) FULL PART2: 3 TRs; cross-check AC-2/3; AC-10 fidelity champ initialisé.**

---

## SP5 — REVIEW Gate (post-IMPLEMENT, indépendant)
### Non exécuté à cette phase. Créé review.md séparément.
### Couverture AC-10 rubric fidelity finale (score 2/2 si ordre strict respecté).

---

## Couverture Synoptique Globale (10 AC × ≥2 TRs minimum)
| AC | Type | Nombre TRs dédiés | Couverture PASS? |
|----|------|-------------------|------------------|
| AC-1 | rule | T1.TR1..T1.TR8 = 8 TRs | ✅ ≥2 |
| AC-2 | rule | T2.TR1..T2.TR6 = 6 TRs + T9 cross 2 | ✅ ≥2 |
| AC-3 | rule | T3.TR1..T3.TR5 = 5 TRs + T9 cross 1 | ✅ ≥2 |
| AC-4 | rule | T4.TR1..T4.TR6 = 6 TRs | ✅ ≥2 |
| AC-5 | rule | T5.TR1..T5.TR15 + T6.TR1..T6.TR6 = 21 TRs | ✅ ≥2 |
| AC-6 | rule | T7.TR1..T7.TR7 = 7 TRs | ✅ ≥2 |
| AC-7 | rubric | T8.TR1..T8.TR3 = 3 TRs | ✅ ≥2 |
| AC-8 | rubric | T2.TR7 matrice + T9.TR3 JSON champ = 2 TRs | ✅ ≥2 |
| AC-9 | rubric | T8.TR4..T8.TR6 (3) + T9.TR1..T9.TR3 (3) = 6 TRs | ✅ ≥2 |
| AC-10 | rubric | T9.TR6 workflow_fidelity + SP5 review fidelity = 2 points | ✅ ≥2 |

**Total TRs estimés: ~70+ atomic tasks. → Couverture 10 AC toutes dépassant 2 TRs minimum.**

---

## Prochaine étape après TASKS: SP3 APPROVE
→ Appeler NotifyUser pour demander approbation explicite spec.md + tasks.md.  
→ Après retour approbation = true → EXÉCUTION SÉQUENTIELLE T0 → T9.
