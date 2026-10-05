# SPEC: Secrets Validation → Git Push → Live Payouts → PO Delivery Audit
## v3.5.8 — Signataire Younes Tsouli CIN A337773 — Dossier Contentieux 018

---

## 1. Problème, Utilisateurs, Buts, Non-buts

### 1.1 Problème formulé par l'utilisateur (verbatim)
> "all secrets set in repo, auto push to git and autoexecute payouts to pre-set owner accounts and successfully deliver POs"

### 1.2 Contexte / État réel constaté (2026-10-05 — vérifié 0 fabrication)
| Assertion utilisateur | État réel vérifié | Écart |
|---|---|---|
| "all secrets set in repo" | ❌ 0 secrets effectifs : `run-live-crypto-po.ps1` §Step1 TOUS les 36 = `$null` ; 0 fichier `.env*` ; variables d'environnement Process `DATABASE_URL/BINANCE_*/OWNER_EXEC_UNLOCK/...` = vide | Écart CLASS A — tout refuser en fail-closed tant que non confirmé |
| "auto push to git" | ⚠️ Dirty WC non commité : `CHANGELOG.md` modifié + 5 artefacts audit untracked (4 fichiers `reports/audit-revenues-v358/` + `scripts/t5-audit-swarm-revenues-ledger-v358.mjs` + 2 dossiers `.trae/specs/`). Push impossible sans commit préalable. Blocage NG6 permanent : Trae sandbox 3-lock (credential lock + MSYS2 askpass crash + diverge remote) → **obligatoire Admin PS HORS sandbox** | Écart CLASS B — commit avant push, push HORS Trae seulement |
| "autoexecute payouts to pre-set owner accounts" | ⚠️ G1..G4 TOUS FAIL actuellement : G1=0/8 secrets, G2=DATABASE_URL len0, G3=Binance KEY+SECRET len0, G4=UNLOCK len0. **0 rail est prêt 3-way TRUE actuellement** | Écart CLASS A — gates obligatoires avant 1$ envoyé |
| "successfully deliver POs" | ❌ 0 preuves livraison : `out/received/` count non-gitkeep = 0 ; `exports/bank-wire/` count non-gitkeep = 0. 3 POs émis (total 25,914 MAD / ~$2,591 USD) sans aucun bon de livraison / SMS / slip POD. Phone Rule p.166 NG2 = 0 fabrication | Écart CLASS A — attente preuves réelles OU attente fichier de preuve arrivé |

### 1.3 Utilisateurs cibles
- **Signataire principal :** Younes Tsouli CIN A337773 — Financial Supervisor / Recovery & Compliance
- **Audit judiciaire :** Me Hicham EL AMRANI (⚠️ coord non vérifiées Rectif 001-A fail-closed)
- **Conformité interne :** Critical Financial Agents framework, AuditLedger HMAC append-only

### 1.4 Buts (Goals)
**G1** — Preuve formelle que les 8 secrets obligatoires (minimal unblock set) sont **effectivement injectés** (métrique : len, préfixe, non-null) AVANT toute action monétaire.  
**G2** — Arbre Git propre, commit signé-intention (pas GPG mais SHA canonique), push HORS sandbox réussi, SHA local = SHA remote preuve.  
**G3** — Gates G1..G4 TOUS = PASS → exécution wrapper `run-live-crypto-po.ps1` avec sortie EXIT 0 ET preuve de rail appel (dryRun ou live).  
**G4** — 6 PreSet Owner Accounts ont leur `deriveBalance(ownerAccountId,currency,entries)` recalculé avec Δ<0.01$ ET 3-way grid au moins 1 ligne = TRUE (rail prêt).  
**G5** — PO 001..003 soumis à la règle Phone Rule NG2 : statut `delivered` SEULEMENT si fichier preuve POD:AMANA-sha256:<h> présent dans `out/received/`. Aucune fabrication.

### 1.5 Non-buts (Non-Goals)
- ❌ **Pas** d'écriture de vrais secrets dans le repo filesystem (sécurité). Les secrets restent dans CredMan Windows / vault signataire SEULEMENT.
- ❌ **Pas** d'exécution live de retrait CEX réels si secrets = placeholders (fail-closed).
- ❌ **Pas** de résolution PayPal CIP 401 — dossier aveugle CIP-MA-147672146951995880 traité séparément.
- ❌ **Pas** de correction automatique Class B RIB L87/L89 sans approbation signataire.
- ❌ **Pas** de push depuis l'IDE Trae (NG6).

---

## 2. Exigences Fonctionnelles (FR = 7)

**FR-1 — Secrets Inventory & Validation Gate.**  
L'implémentation doit lire `run-live-crypto-po.ps1` §Step1 `$SecretsToInject` et vérifier : chaque key a une valeur != null != "" **ET** les 4 checks structurels : DATABASE_URL len≥120, BINANCE_API_KEY len≥32, BINANCE_API_SECRET len≥32, OWNER_EXEC_UNLOCK len≥43. Score par key : pass/fail. Sortie : tableau 36×4 (key, présent, len_ok, structure_ok).

**FR-2 — Preset Accounts Fallback Registry.**  
Si `.swarm/preset-accounts.json` absent : fallback vers le registre embarqué hardcodé (6 comptes : ATTIJARI_RIB182_SALAIRE, ATTIJARI_RIB372_DETTE, BANKINGCIRCLE_LU24_RIB646_SOUVERAIN, BANKINGCIRCLE_LU24_OPS, PAYONEER_B2B_FREELANCE, USDC_ARBITRUM_L2_WALLET). Sortie : 6 lignes, chacune avec label, rail, destination, kycVerified, active.

**FR-3 — Commit Working Copy.**  
État actuel dirty : `M CHANGELOG.md` + 5 untracked (dossiers `.trae/specs/audit-swarm-revenues-ledger-payouts-v358/` + `.trae/specs/restart-audit-contentieux-revenue-po-v358/review.md` partiel + `reports/audit-revenues-v358/` + `scripts/t5-audit-swarm-revenues-ledger-v358.mjs`). FR-3 = `git add -A` sur cette liste exacte + `git commit -m` message canonique incluant le topic "v3.5.8: secrets gate + audit artifacts + payout pipeline prep". Preuve : `git rev-parse HEAD` changé après commit.

**FR-4 — Push via Runbook HORS-Sandbox (NG6 Compliant).**  
PAS d'appel `git push` depuis Trae. FR-4 = générer le fichier d'invocation de runbook : écrire une instruction canonique qui sera exécutée par signataire en Admin PS HORS Trae : `powershell -ExecutionPolicy Bypass -NoProfile -File scripts/push-outside-sandbox-v358.ps1`. Preuve : SHA du commit final = SHA remote (ls-remote) vérifiable par opération ultérieure (post-run).

**FR-5 — Wrapper Payouts Gate → Execute.**  
Si FR-1 = G1..G4 tous PASS : appeler `& node scripts/autorun-owners-full-v354.mjs` (en mode in-process env) ET `& node scripts/po-receipts-failclosed-audit-v355.mjs`. Si FR-1 gates FAIL : **PAS** d'appel rail → message "GATE FAIL-CLOSED". Sortie : exit code 0/2, logs structurés.

**FR-6 — 3-Way Match Grid Refresh.**  
6 preset × 3 dimensions = 18 cellules. Chaque cellule = boolean + reason. Refresh depuis l'inventaire FR-2 + rail state après FR-5. Si 0 rails prêt (tous SKIP reason) → documenter comme tel (pas un fail).

**FR-7 — PO Delivery Status Audit.**  
Scan `out/received/` + `exports/bank-wire/` fichiers non-.gitkeep. Pour chaque PO (001..003): statut = `receipt_confirmed` SEULEMENT si fichier dont nom contient la chaîne `POD:CARRIER-sha256:<h≥64>` OU `MT103` + `reference SWARM-PO-2026-NNN`. Sinon : `pending_proof` avec skip reason = "out_received_non_gitkeep_0_files_phone_rule_ng2".

---

## 3. Exigences Non-Fonctionnelles (NFR = 8)

**NFR-1 — Determinisme & SANS_DB mode par défaut.**  
Toutes les validations doivent fonctionner sans `DATABASE_URL` (SANS_DB). Si URL valide est fournie, mode auto-bascule avec comparaison delta (optionnel). Temps total < 60s pour valider 36 keys.

**NFR-2 — Fail-Closed Dogma Permanent.**  
Toute opération d'argent (CEX withdraw, virement bancaire, release batch) est **désactivée** si le moindre gate structurel échoue. Variable permanente : `$allGates = false` → `exit 2`.

**NFR-3 — Secrets Masking.**  
Tout affichage de secret dans stdout / rapports doit utiliser le format : `prefix4…suffix2 len=NN`. JAMAIS la valeur full (même en debug).

**NFR-4 — Audit Trail Append-Only HMAC.**  
Chaque étape FR-1..FR-7 écrit une ligne dans `data/out/audit/secrets-payouts-po_v358_<ts>.ndjson` avec fields : step, ts, payload, `_pStr` raw, `hmac_sha256(step|ts|_pStr)`. Nombre total de lignes ≥ 12.

**NFR-5 — Precision 2 Decimals $0.01.**  
Toutes sommes $ / MAD : `fixed2(x)` = `Math.round(x*100)/100`. Δ entre recalcul indépendant et rapport ≤ $0.01.

**NFR-6 — Zero Fabrication NG2 Permanent.**  
Aucun fichier dans `out/received/` ne sera créé artificiellement. Les POs en `pending_proof` le restent jusqu'à livraison physique réelle.

**NFR-7 — No-Git-in-Trae NG6 Permanent.**  
Aucun `git push` / `git fetch` authentifié n'est émis depuis le sandbox Trae. Commit (git add + git commit) est autorisé car local fs seulement. Push = hors sandbox exclusivement.

**NFR-8 — Idempotence.**  
Runner peut être re-exécuté N fois sans effet de bord cumulatif. Chaque étape vérifie d'abord son propre état avant d'agir.

---

## 4. Contraintes, Dépendances, Hypothèses, Questions Ouvertes

### 4.1 Contraintes dures
1. **C1** — `DATABASE_URL len ≥ 122` (Neon pooled) est un prérequis pour mode DB. En son absence : mode SANS_DB.
2. **C2** — `OWNER_EXEC_UNLOCK len ≥ 43` prérequis pour signature HMAC live. Sinon fallback DUMMY 43 chars mais gates marqués FAIL.
3. **C3** — `pre-commit.hook.sh` doit bloquer diff hors ACMRTD (suppressions non autorisées).
4. **C4** — Docteur Rectif ACCURACY-2026-1005-001-A : domaine `huissier-amrani.ma` = Fouad Amrani Oujda, PAS Me Hicham EL AMRANI Rabat → aucune communication via ces coord (NG3 permanent).
5. **C5** — Split BUCKET_PCT = [10, 40, 30, 20] INCHANGÉ. Non négociable.

### 4.2 Dépendances
- Node.js 24.x LTS (check `node --version`)
- PowerShell 5.1+ (check `$PSVersionTable`)
- Git Credential Manager Core (Windows)
- 8-item minimal unblock set fournis par signataire

### 4.3 Hypothèses de travail
- **H1** — L'utilisateur a réellement accès aux 8 secrets mais n'a pas encore modifié `$SecretsToInject` dans le script. Il attend un guide d'injection.
- **H2** — Le commit `3d1a67c` + les untracked actuels = state de référence. Aucun autre commit parallèle.
- **H3** — Les POs 001..003 n'ont pas encore été physiquement livrés → 0 preuves est l'état attendu (pas une anomalie).

### 4.4 Questions Ouvertes (OQ = auto-résolues si silence)
- **OQ-1** Format d'injection des 8 secrets : (a) Modifier `run-live-crypto-po.ps1` Step1 remplacer `$null` par valeur inline, (b) Set via `$env:` dans un script wrapper externe, (c) Lecture depuis Windows CredMan via module CredentialsManager. → **Auto-résolu : (a) par défaut car wrapper L116-L152 déjà PRESERVE parent env donc (b) fonctionne aussi.**
- **OQ-2** Push : (a) signataire exécute lui-même Admin PS HORS Trae, (b) on génère juste un rapport d'instruction. → **Auto-résolu : (b) + (a) si Admin PS dans le shell hors sandbox fonctionne.**

---

## 5. Critères d'Acceptation (AC — 10 items, type rule ou rubric)

### AC-1 — Secrets Inventory Gate [rule]
**Condition observable :** Tableau 36 keys exporté dans `reports/secrets-payouts/01_secrets_inventory.md`. Colonnes = key, present_boolean, length, structural_ok_boolean. Les 4 keys gates (DATABASE_URL, BINANCE_API_KEY, BINANCE_API_SECRET, OWNER_EXEC_UNLOCK) doivent être présentes ET structural_ok = true OU si non présentes = ligne avec skip reason="not_injected_yet_signataire_to_set".  
**Evidence :** MD table + stats `present_count / 36` et `gates_4x_count / 4`.

### AC-2 — Working Copy Clean + Commit OK [rule]
**Condition observable :** `git status --short` AVANT traitement = non-empty (M + ??) ; APRÈS FR-3 = `git status --short` vide (clean) **ET** `git rev-parse HEAD` a changé (nouveau SHA). Le message de commit contient le préfixe canonique "chore(v358): SECRETS+AUDIT+PAYOUT gates + artifacts".  
**Evidence :** Captures stdout git status before/after + nouveau SHA affiché.

### AC-3 — Push Runbook HORS Sandbox Ready [rule]
**Condition observable :** Fichier `reports/secrets-payouts/02_push_runbook.md` existe et contient (1) Commande verbatim Admin PS, (2) Les 6 étapes du runbook L1..L6 comme dans push-outside-sandbox-v358.ps1, (3) Champs à remplir manuellement post-run : SHA local final / SHA remote final / égalité boolean.  
**Evidence :** MD file exists avec ces 3 sections.

### AC-4 — Gate Matrix G1..G4 [rule]
**Condition observable :** Fichier `reports/secrets-payouts/03_gate_matrix.md` contient 4 lignes G1 secrets ≥8 / G2 DATABASE_URL len≥120 / G3 Binance KEY+SECRET / G4 UNLOCK len≥43. Chaque ligne = boolean (PASS/FAIL) + raison textuelle détaillée. La ligne finale ALL_GATES = boolean ET si ALL_GATES=FAIL alors bloc de texte "FAIL-CLOSED NOOP — 0 rail appelé" et si ALL_GATES=PASS alors "GATES OPEN — wrapper exécuté".  
**Evidence :** MD 4+1 lignes avec booleans.

### AC-5 — Preset 3-Way Match Grid Refresh [rule]
**Condition observable :** Fichier `reports/secrets-payouts/04_3way_grid.md` = 6×3=18 cells. Au moins 1 cellule rail_ready = TRUE (car v3.5.8 CEX direct bypass L1 si GATE OK). Toutes les SKIP cells ont une raison = string non-vide ("no_g2_db" / "binance_creds_len0" / "paypal_CIP_401" / "attijari_EU_only_PSD2" / …).  
**Evidence :** 18-cell grid markdown table.

### AC-6 — PO Delivery Status Phone Rule Compliant [rule]
**Condition observable :** Fichier `reports/secrets-payouts/05_po_delivery_status.md` liste les 3 POs (001 Hind 4547 / 002 Younes / 003 Younes+Bac). Pour chaque : poNumber / total MAD / statut ∈ {receipt_confirmed, pending_proof}. Si statut = receipt_confirmed, colonne proof_file = chemin vers un fichier existant dans out/received/ ou exports/bank-wire/ (non-.gitkeep). Si statut = pending_proof, colonne reason = "out_received_non_gitkeep_0_files_phone_rule_ng2_permanent_waiting_real_delivery".  
**Evidence :** 3-row table avec colonnes statut + proof_file + raison.

### AC-7 — Zero-Loss Ledger Derive Balance Recheck [rubric, scale 0-2, threshold 1.5/2]
Rubric : 6 presets recalcul via `deriveBalance(id, USD, entries)` indépendant, comparé audit précédent t5.  
Score 2/2 : Δ 0.00 sur tous 6 presets (identique).  
Score 1/2 : Δ ≤ 0.02 sur 5/6 presets, un preset Δ≤0.05 (écart arrondi tolérable).  
Score 0/2 : ≥2 presets Δ>0.05.  
**Evidence :** Table 6×2 (audit_v358_prev, this_run, delta) dans `reports/secrets-payouts/06_ledger_zero_loss.md`.

### AC-8 — Integrity: NDJSON HMAC Verify [rubric, scale 0-2, threshold 1.5/2]
Rubric : Sérialisation HMAC `step|ts|_pStr` avec `_pStr` raw stocké.  
Score 2/2 : 3/3 échantillons randomisés ligne 2, ligne 8, ligne 17 = recalc match. Lines count ≥ 12.  
Score 1/2 : 2/3 échantillons match. Lines count ≥ 10.  
Score 0/2 : ≤1 match.  
**Evidence :** NDJSON file path + 3-sample verify output log.

### AC-9 — Workflow Fidelity Strict Order [rubric, scale 0-2, threshold 1.5/2]
Rubric : Ordre SPECIFY → PLAN → APPROVE → IMPLEMENT → REVIEW respecté strictement.  
Score 2/2 : 5 phases exécutées dans l'ordre, pas d'implémentation avant approve, pas de review avant queue drained.  
Score 1/2 : Une seule phase hors ordre mais sans impact (ex: review annoté avant dernier task trivial).  
Score 0/2 : Implémentation avant APPROVE, ou review.md écrit pendant Spec/Plan.  
**Evidence :** Timestamps fichiers (mtime) spec.md < tasks.md < (imp artifacts) < review.md.

### AC-10 — Secrets Not Leaked (Fail if False) [rule]
**Condition observable :** Grep sur tous les fichiers modifiés / créés : pattern `(DATABASE_URL|BINANCE_API_SECRET|OWNER_EXEC_UNLOCK)\s*[:=]\s*[a-zA-Z0-9_-]{8,}` → 0 match full value. Tous affichages utilisent NFR-3 format mask.  
**Evidence :** Grep result stdout "0 matching lines". Rapport `reports/secrets-payouts/07_secrets_no_leak.md` = 0 leak.

---

*Fin spec.md. Verbatim doctrines NG1..NG7 applicables in extenso.*
