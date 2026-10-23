# État des lieux & plan — PO / zspace / Attijari Contentieux

Date : 2026-10-23 · Mode : outillage + commandes sûres (read-only) · Aucune donnée fabriquée, aucun envoi externe.

---

## 1. PO deliveries — durci fail-closed ✅

**Livré (working tree, non commité)**
- Garde partagé : `scripts/lib/po-delivery.mjs` (POD = `POD:<CARRIER>:sha256(scan)` d'un bordereau signé réel ; le tracking transporteur est une entrée externe).
- Wrappers réécrits : `scripts/swarm-po-delivery-executor.mjs`, `scripts/auto-deliver-owner-pos.mjs` (plus aucune fabrication, plus d'auto-commit/push).
- Invariant anti-régression **I7** : `scripts/verify-swarm-invariants.mjs`.
- Tests : `scripts/po-delivery.test.mjs` (30/30).

**Vérifications exécutées**
- `node scripts/verify-swarm-invariants.mjs --json` → **10/10 invariants OK**.
- `npx vitest run scripts/po-delivery.test.mjs` → **30/30**.
- Dry-run read-only → **ready=0 / blocked=3** (001, 002, 003).

**Blocage actuel (preuves réelles manquantes)**
- `data/out/po/carrier-tracking.json` : **absent** (suivi transporteur non fourni).
- `out/received/` : seulement `.gitkeep` (aucun scan signé).

**Ajouté** : gabarit `data/po/carrier-tracking.example.json` (contrat d'entrée documenté, aucune valeur réelle). Emplacement choisi car `data/out/**` est ignoré par Git (règle `.gitignore` `out/`) et ne serait donc pas conservé.

**Pour débloquer (côté owner, hors bot)** : exporter le suivi réel transporteur, scanner les bordereaux signés dans `out/received/`, puis lancer avec `DATABASE_URL` + `OWNER_EXEC_UNLOCK` (≥16).

---

## 2. zspace deploys — état fail-closed (relevé live 2026-10-23)

| Cible | Mécanisme | Statut live |
|---|---|---|
| T1 GitHub https-origin | `push-outside-sandbox-v358.ps1` Admin HORS Trae | 🔒 Runbook admin (NG6) — `git remote` ne contient que `origin` (pas de `https-origin`) |
| T2 GitLab mirror | `sync-mirrors.cmd` push --mirror | ❌ SKIP — `GITLAB_MIRROR_REPO` + `GITLAB_PAT` absents |
| T3 Codeberg mirror | push --mirror SSH | ❌ SKIP — `CODEBERG_MIRROR_REPO` absent |
| T4 Local backup mirror | push --mirror local | ❌ SKIP — `LOCAL_MIRROR_DIR` absent |
| T5 zspace swarm dirs + logs | `mkdir` + probe | ✅ OK (`data/swarm_autonomy/logs`, `data/out`, `out/received`, `exports/bank-wire` présents) |
| T6 Base44 SDK cache | `@base44/sdk` pull | ❌ SKIP — `BASE44_APP_ID` + `BASE44_SERVICE_TOKEN` absents ; `.base44-cache/` absent |
| T7 Doomsday Vault local | `backup-doomsday-vault.ps1` | ❌ SKIP — `DOOMSDAY_ARCHIVE_PASSPHRASE` absent + `.keys/doomsday-passphrase.txt` absent |
| T8 Secure-Cloud Supabase | `secure-cloud-upload.cmd` | ❌ SKIP — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `MIRROR_SUPABASE_BUCKET` absents |
| T9 Vercel frontend | `deploy-vercel.yml` | ⛔ Exclu par choix owner |

**Env (présence, valeurs non affichées)** : **0/16 présents** (DATABASE_URL, LIVE_BANK_API, OWNER_EXEC_UNLOCK, OWNER_HANDS_FREE_POLICY, GitLab/Codeberg/Local mirror, Supabase ×3, Base44 ×2, Vercel ×2).

**Conclusion** : les déploiements miroirs/cloud restent bloqués faute de secrets/env. Aucun script de push n'a été exécuté (hors périmètre « sûr »).

---

## 3. Attijari Contentieux — read-only vérifié ✅

**Exécuté**
- `scripts/attijari-readonly-probe.ts` → `LIVE_BANK_API not set - refusing to attempt live call (fail-closed)` — **aucun appel live**.
- `scripts/attijari-address-book-v354.mjs` → **6 destinations MA**, BIC `BCDIMAMC`, templates MT103 générés. Sortie écrite dans `data/out/` (ignoré par Git → **pas de PII committée**).

**Point d'attention (sécurité)**
- `src/lib/attijariwafa-psd2.ts` **n'est pas read-only** : il expose `initiatePayment()` (POST `/payments/sepa-credit-transfers`), utilisé par `src/app/api/exchanges/route.ts` et `src/lib/treasury/release-engine.ts`. La probe ci-dessus n'utilise que des GET, mais la capacité de paiement existe dans le module. Toute exécution doit rester gatée.
- Contrainte **Signataire Solo** respectée : aucun envoi externe (PDF/e-mail/courrier) effectué par le bot.

---

## Plan priorisé

1. **PO (owner)** — Fournir les preuves réelles (suivi transporteur + scans signés) pour passer `blocked` → `ready`. Le bot ne peut pas produire ces preuves.
2. **PO (bot, optionnel)** — Ajouter un mode `--plan-only` au CLI (plan sans connexion DB) pour un dry-run intégré. *(Proposé, non fait.)*
3. **zspace (owner)** — Provisionner les env manquants (ou acter le SKIP permanent) pour activer T2/T3/T4/T6/T7/T8.
4. **Attijari (bot, sécurité)** — Ajouter un garde-fou (invariant/CI) interdisant tout appel non gaté à `initiatePayment`. *(Proposé, non fait.)*

---

## Changements en working tree (non commités)

```
 M scripts/auto-deliver-owner-pos.mjs
 M scripts/swarm-po-delivery-executor.mjs
 M scripts/verify-swarm-invariants.mjs
?? scripts/lib/po-delivery.mjs
?? scripts/po-delivery.test.mjs
?? data/po/carrier-tracking.example.json
?? reports/assist-status-plan-2026-10-23.md
```
