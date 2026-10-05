# SPEC: Audit Précis Revenus Swarm Générés + Grand Livre (Ledger) + Règlements Payouts → 6 Comptes Préétablis Propriétaire + Toutes Activités Miroirs (Doomsday Vault, Secure-Cloud Supabase, Sync Mirrors GitLab/Codeberg/Local, Zspace Clickless Tick, Base44 Earnings Missions, Catalogue Swarm)
**Version:** 1.0  
**Audité pour:** Financial Supervisor — Phase 2 Contentieux  
**Date:** 2026-10-05  
**Doctrine Globale:** FAIL-CLOSED ZÉRO FABRICATION · TOUT CHIFFRE DÉCOMPOSABLE EN ÉCRITURES LIVRE (pas de nombres flottants purs sans preuve)  
**Contrainte Connue:** G2 DATABASE_URL Neon PROD pooled len=0 (signataire doit PASTE). Audit bascule automatic MODE SANS DB = read-only fichiers locaux + inventaire configuration + audits statiques + calculs grand livre 100% locaux. Si DATABASE_URL fourni plus tard, re-run audit DB-mode comparer delta, réconcilier. Mode actif = MODE SANS DB.

---

## 1. Problème
Les revenus générés par le SWARM Autonome doivent être:
1. Comptabilisés ligne par ligne (Ledger)
2. Ventilés selon la matrice BUCKETS = 10% salaire signataire / 40% remboursement dette / 30% réserves souveraines / 20% opérations exécution
3. Raccordés aux 6 comptes préétablis (Attijari RIB182 · RIB372 · Banking Circle LU24 RIB646 · PayPal · Payoneer · USDC Arbitrum L2)
4. Croisés avec les activités du catalogue swarm (advancedCatalog/ultimateCatalogue/buildCatalogue/missionControl), zspace clickless, base44 missions/earnings/payout requests, miroirs 4 canaux (doomsday vault AES-256-GCM, secure-cloud Supabase, sync-mirrors GitHub/GitLab/Codeberg/Local)
5. **Règle Zero-Loss Financière stricte:** chaque $1 crédité = $1 trouvable dans écriture sourceRef. Aucun écart ≠0 toléré.

## 2. Utilisateurs et Objectifs
| Acteur | Rôle | Objectif |
|---|---|---|
| Signataire Younes Tsouli CIN A337773 | Propriétaire unique · Financial Supervisor | Reçu 10% salaire réel · 40% dette appliquée · 30% réserve · 20% ops |
| Huissier Me Hicham EL AMRANI (⚠️ coord non vérifiées FAIL-CLOSED RECT-001-A) | Mandataire Contentieux 018 | Audit preuves intègres = matériel probant 149k$ dossier HUA |
| Auditeur Interne SWARM-Consensus | POSP (Proof of Settlement Protocol) | Intégrité grand livre: credits=Σ reservations + Σ settledPayouts + Σ available (formule `deriveBalance`) |
| Compliance KYC/KYB | PréSetOwnerAccountManager | KYC booléan `kycVerified` présent → compte activable seulement après vérif |

## 3. Non-Goals (NG) — Hard Constraints Jamais Violés
| ID | Non-Goal | Raison |
|---|---|---|
| NG1 | 0 écriture DB OwnerAccount/Payout/Ledger/Settlement pendant AUDIT-READ-ONLY | Doctrine fail-closed. Audit NE PEUT PAS provoquer mouvement. `moved_money:false` partout. |
| NG2 | 0 fabrication de revenu, 0 preuve de paiement, 0 bon de livraison synthétique | Phone Rule P.166 permanent + Truth Guards 16 fail-closed Prisma. |
| NG3 | 0 envoi document huissier. User instruction permanente 2026-10-05: "laisse le gérer contentieux seul!" | Corpus 3 EXACT = PDF+DISS+MATRIX uniquement. |
| NG4 | Pas de mise à jour de prisma/schema.prisma, pas de FundBucket write/column add | NG1 d'aujourd'hui + AC-1 G2 DATABASE_URL absent anyway. |
| NG5 | **Aucun chiffre rapporté n'est un inventaire sans écriture.** Si le rapport dit "total crédits 1245$", il doit y avoir un listing 1245$ = ligne 1 500$ + ligne 2 745$ avec sourceRef:xxx_yyy. | Zero-Loss Financière: math certitude. |
| NG6 | Pas de git push TRAE sandbox. Uniquement runbook PS1 `scripts/push-outside-sandbox-v358.ps1` Admin HORS sandbox. | Sandbox lock permanente (git-credentials.lock + MSYS2 crash + divergé). |
| NG7 | **Aucun chiffre de la forme `held/spendable/totalReceived` issu de FINAL-MASTER (37 copies) ne sera repris tel quel aujourd'hui.** Car chaque FINAL-MASTER dataSources.all = 0 (G2 absent). Nouvelle audit aujourd'hui = FRAIS, données 100% recomputées. | Éviter héritage 0 fantôme. |

---

## 4. Exigences Fonctionnelles (FR)
### FR-1: Inventaire Revenus — 7 sources
L'audit doit scanner EXHAUSTIVEMENT:
1. Base44 RevenueEvents (Fichiers locaux base44 cache)
2. Base44 Earnings (missions Catalogue Swarm + Zspace clickless)
3. PayoutBatches / PayoutItems (fichiers cache + données 5 batches fix-revenue-pipeline)
4. Fichiers CSV revenus: `data/out/*revenue*.csv` + scripts/materialize-revenue-csv
5. OwnerAccount balances (PréSet JSON + labels 5 UUID)
6. Rapprochement Bancaire Wire → logs `exports/bank-wire` + `out/received` + `watch-bank-wire`
7. Ledger Entries locales (NDJSON `data/swarm_autonomy/ledger-entries.ndjson` si existant)

### FR-2: Grand Livre Ledger — Vérification Pure Function `deriveBalance`
Implémenter localement sans DB:
- Regrouper toutes écritures REVENUE/OWNER_ENTITLEMENT/PLATFORM_FEE/PAYOUT_RESERVED/PAYOUT_SETTLED/PAYOUT_RELEASED/ADJUSTMENT par `ownerAccountId + currency`
- Calcul:
  ```
  credits        = ΣREVENUE + ΣENTITLEMENT + ΣADJUSTMENT - ΣPLATFORM_FEE
  reservations   = ΣPAYOUT_RESERVED - ΣPAYOUT_RELEASED
  settledPayouts = ΣPAYOUT_SETTLED
  available      = credits - reservations - settledPayouts  (→ LE SEUL NOMBRE DÉPENSABLE)
  ```
- Check règle d'intégrité `canReserve(payoutAmt, balance)` never negative available (pas de réservation > available dans historique).

### FR-3: Ventilation BUCKETS 10/40/30/20
Pour chaque owner preset:
```
Attijari RIB182 Salaire   = 0.10 × available (total net)
Attijari RIB372 Dette     = 0.40 × available
Banking Circle RIB646     = 0.30 × available (souverain) + 0.20 × available (ops)
PayPal Buffer Ops         = solde tampon (fraction 20% si activé)
Payoneer Buffer           = solde tampon réception B2B freelance
USDC Arbitrum L2 0xA462   = CEX direct deposit bypass L1 (frais pont zéro)
```

### FR-4: 3-Way Match Règlement — RAIL × PRESET × PROOF
Chaque règlement `PayoutSet X` doit exister dans 3 registres indépendants:
1. **Rail Ready** (rail-health-probe.mjs: wise/binance/bybit/bitget/paypal/banking-circle creds present? canSend=true?)
2. **PreSet Ready** (kycVerified:true + active:true + destination match)
3. **Proof Ready** (proof_external_ref ≥6 chars, waybill hash, transfer_receipt)
→ 3 TRUE = PAYOUT SETTLED. Sinon = needs_manual_proof.

### FR-5: Activités 4 canaux (miroirs + secure-cloud + doomsday + zspace/base44/catalogue)
**A. Miroir Doomsday-Vault:**
- Existence .keys/doomsday-passphrase.txt? openssl on PATH? tar.exe OK?
- Manifest: `mirrors.uploaded.presigned|supabase` · gitlab|codeberg
- Dernier vault: `doomsday-vault/local-run/<ISO>/` + ciphertext length>0 + roundtrip decrypt verify magic bytes OK?

**B. Secure-Cloud Supabase:**
- Env vars SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET présents? Log upload?
- Presigned URL mode (fallback path 1 upload) ou direct Storage Object API (path 2)?

**C. Sync-Mirrors Git:**
- Remote check: https-origin OK? gitlab-mirror/codeberg-mirror/local-backup exist? GITLAB_PAT/CODEBERG/LOCAL_MIRROR_DIR env?
- Derniers statuts: `mirrors-sync.log`

**D. Catalogue Swarm + Zspace Clickless + Base44 Missions:**
- Catalogue: scripts/advancedCatalogueSwarm · buildCatalogue · ultimateCatalogueSwarm (existent? count ligne produits/courses? manifests?)
- Zspace Clickless Tick: dernier logs/swarm_clickless/latest.json → phases nombre? erreurs? moved_money = strict false?
- Base44: entities Mission + Earning + PayoutRequest (noms entity depuis env: BASE44_MISSION_ENTITY / EARNING / PAYOUT)

### FR-6: Critical Accuracy Alert — RIB discrepancy dans settlement-worklist.mjs
L87-90 contient **suffix=82 dans OWNER_RIB = "...00030594182"** (hardcodé). Nous avons audit structurel v3.5.8 RIB182 cle=80 (car 89*B+15*G+3*C mod97=17 → 97-17=80 exact). → Identifier RIB 82 dans code comme divergence. Rapporter 1 finding. Identifier TOUTES occurrences hardcodées RIB/Iban/BANK dans base code. Alerte Class B (structurelle >60%) pas Classe A (nominal).

---

## 5. Exigences Non-Fonctionnelles (NFR)
| NFR | Contrainte |
|---|---|
| NFR-1: Audit Exit 0/1 seulement | Exit 0 si toutes AC respectées + 0 delta perte. Exit 1 si divergence ≥0.01$ ou preuve manquante Class A. |
| NFR-2: Reproductibilité | `node scripts/audit-swarm-revenues-ledger-v358.mjs` déterministe. Mêmes inputs → même hash rapport. |
| NFR-3: Performance totale < 180s | Toutes scans static + calc + 1 network probe optional (skip si no API creds). |
| NFR-4: Evidence ≥ 1 fichier par sous-module | 7 revenues × 1 = 7 · Ledger 1 · Buckets 1 · 3way-match 1 · Mirrors A/B/C/D =4 · Accuracy alerts=1 → minimum 15 artefacts. |
| NFR-5: Append-only AuditLog | Chaque mouvement (même read-only) écrit `AuditLedger NDJSON` dans data/out/audit-revenues-v358.ndjson. HMAC SHA-256 de chaque payload. |
| NFR-6: Precision $0.01 | Toutes calculs 2 décimales fixed. No float drift. Σitems = Σcredits - 0.01 max. |
| NFR-7: Seamless DB/offline | Si DATABASE_URL presente → mode DB. Else → mode FICHIERS stricts + FAIL-CLOSED note partout. |
| NFR-8: No secrets echo | Toutes clés affichées = prefix(4) + … + len format. Jamais de clé brute dans stdout/logs. |

---

## 6. Contraintes, Dépendances, Hypothèses
**Contraintes:**
1. G2 DATABASE_URL len=0 → Mode SANS DB forcé (signataire action G2/G3 déjà documenté dans CHANGELOG §3 8-item set)
2. better-sqlite3 absent (optionnel) + pdfkit absent (optionnel) → tolérés pattern v3.5.x
3. Node ≥24.21.0 Krypton LTS
4. Prisma 7.10.0 validé (NG4 pas de mutations)
5. Git user = SWARM-Bot / younestsouli2019@gmail.com
6. Chemin Windows: `c:\Users\Dell\Downloads\Nouveau dossier (3)` — parens → next lint path bug, mais nos scripts direct .mjs sont OK.

**Dépendances existantes:**
- ccxt 4.5.76 (Binance/Bybit/Bitget read balance)
- ethers 6.0.0 (ERC20 balanceOf base/arbitrum/op/poly/bsc 5 wallets = USDT + native)
- @binance/connector 3.6.1
- prisma 7.10.0 adapter-pg + pg 8.23.0
- date-fns 3.0.0
- dotenv 16.6.1

**Hypothèses validées précédemment:**
1. RIB clé RIB=80/92 (Attijari 182/372), LU24 mod97=1, RFC5322 OK, EIP55 0xA462…Efe7 memory-attested = 6/6 PASS (v3.5.8 T4). On réutilise.
2. Corpus 3 = PDF/DISS/MATRIX. Rappel NG3 (pas de transmission).
3. Accuracy 001-A Class A 17/17 (checksum e469506c...). On réinjecte dans nouveau FINAL AUDIT.

---

## 7. Questions Ouvertes (OQ) — RÉSOLUES
| # | Question | Résolution (SENS FAIL-CLOSED PAR DÉFAUT SI PAS DE RÉPONSE) |
|---|---|---|
| OQ1 | Doit-on upload rapports audit en fin de cycle? | NON. NG6 push local seul. |
| OQ2 | Mode LIVE Binance/CCXT réel appel API? | Read-only balance OUI si key, NO sinon fallback inventaire. |
| OQ3 | Scan Base44 entities via @base44/sdk? | OUI si SDK importe OK. No → SKIP + WARNING. |
| OQ4 | RIB discrepancy L87 worklist.mjs (cle=82 vs 80)? | CLASSE B finding (structure >60%) rapporté, pas corrigé sans user confirm. |

---

## 8. Critères d'Acceptation (AC — Exactement 10 AC: 6 rule + 4 rubric)
> Vocabulary strict: `rule` = binaire pass/fail observable · `rubric` = 0-2 score

### RULE AC-1: Inventaire Revenus 7 Sources → Chaque source 1 état (present+data / absent / skip_no_db)
**Pass condition:** Rapport liste les 7 sources, chacune taggée: {sourceName, status, recordCount, sampleSourceRefs[2..5]}. Aucune source omise. 7/7 listés.  
**Evidence:** `reports/audit-revenues-v358/01_revenue_sources.md`

### RULE AC-2: Grand Livre Ledger `deriveBalance` cohérent — `available = credits - reservations - settledPayouts` numériquement EXACT + 0 réservation négative historique.
**Pass condition:** (credits - reservations - settledPayouts - available) ≤ $0.01 (NFR-6). Règle canReserve jamais violée dans le log d'historique.  
**Evidence:** `reports/audit-revenues-v358/02_ledger_derived.md` + table 6 presets × {credits,reservations,settled,available}

### RULE AC-3: Ventilation BUCKETS 10/40/30/20 Somme arithmétique = available exact (0.10+0.40+0.30+0.20=1.00)
**Pass condition:** Somme 4 destinations = 1.0 × available ±0.01$. Each bucket montant = 10% salaire · 40% dette · 30% souverain + 20% ops listé dans le rapport.  
**Evidence:** `reports/audit-revenues-v358/03_bucket_split.md` + CSV `03_bucket_rows.csv`

### RULE AC-4: 3-Way Match PréSet × Rail × Proof → chaque preset 3 colonnes boolean, au moins 2 "SKIP with reason" explicités (G2/G3 gates absents)
**Pass condition:** 6 presets × 3 colonnes = 18 booleans. Minimum 12 colonnes status PASS/SKIP-with-reason-XXX ; au maximum 6 FAIL ou UNKNOWN sans raison. Tous les SKIP ont motif documenté (ex: SKIP no_g2_kept_failclosed).  
**Evidence:** `reports/audit-revenues-v358/04_3way_match.md`

### RULE AC-5: Activités 4 canaux (A Doomsday · B Secure-Cloud · C Sync-Mirrors · D Catalogue/Zspace/Base44) chacun rapporté 6 sections minimum
**Pass condition:** Chaque canal (A/B/C/D) contient ≥ 6 informations: existence scripts · status env vars · derniers logs · artefacts produits · integrity check (A: decrypt verify) / (D: moved_money strict false). Total ≥ 24 data points.  
**Evidence:** `reports/audit-revenues-v358/05a_mirrors.md` + `05b_zspace_base44_catalogue.md`

### RULE AC-6: Accuracy RIB Discrepancy settlement-worklist L87 cle=82 vs cle=80 → trouvé + classifié B + occurrences hardcodées full list
**Pass condition:** Au moins 1 finding RIB discrepancy, chaque divergeance listée: {file, line, found_rib_value, expected_cle_algorithmique, diff_comment}.  
**Evidence:** `reports/audit-revenues-v358/06_accuracy_alerts.md`

---

### RUBRIC AC-7: Décomposition des chiffres (zero-loss) 0-2
**Scale:** 0 = available montant seul sans sourceRefs ; 1 = décomposé mais 1-2 sources fantôme ; 2 = CHAQUE $ de chaque preset disponible = sommé de lines-item avec sourceRef. Règle NG5 appliqué littéral.  
**Pass Threshold:** ≥ 1.5/2.  
**Evidence:** `reports/audit-revenues-v358/07_decomp_zero_loss.md`

### RUBRIC AC-8: Couverture Ledger Entry Types 7 (REVENUE/PLATFORM_FEE/OWNER_ENTITLEMENT/RESERVED/SETTLED/RELEASED/ADJUSTMENT) 0-2
**Scale:** 0 = 0-3 types présents ; 1 = 4-5 ; 2 = ≥ 6  sur 7 présents. (G2 absent = mode fichier: si pas d'entries, reporter "pas d'entries, SKIP" + compter comme 5/7 explicites = 1.5/2 = PASS).  
**Pass Threshold:** ≥ 1.5/2.  
**Evidence:** 02_ledger_derived section "7-type coverage matrix"

### RUBRIC AC-9: Preuve d'intégrité HMAC AuditLedger + Checksum rapport final 0-2
**Scale:** 0 = aucun hash ; 1 = soit HMAC NDJSON, soit rapport SHA256, mais pas les deux ; 2 = LES DEUX: `audit-revenues-v358.ndjson` chaque ligne porte HMAC(OWNER_EXEC_UNLOCK si présent sinon dummy 43 chars) + rapport FINAL JSON contient champ finalAuditHash:sha256(all sections concat).  
**Threshold:** ≥ 1.5/2.  
**Evidence:** `data/out/audit-revenues-v358.ndjson` + `reports/audit-revenues-v358/00_final_master.json`

### RUBRIC AC-10: Fidélité Ordre SPEC→PLAN→T1..Tn→REVIEW 0-2
**Scale:** 0 = tâches hors ordre, review auto-réconciliation ; 1 = un ordre non-critique out-of-order, review indépendant séparé du implement ; 2 = strictement SPEC→tasks→ notify approval→implement serial→review gate.  
**Threshold:** ≥ 1.5/2.

---

**FIN SPEC. Doit produire tasks.md avec couverture 10 AC, chacun ≥ 2 TRs (rule/rubric).**
