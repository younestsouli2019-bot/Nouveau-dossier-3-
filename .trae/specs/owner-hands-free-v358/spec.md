# SPEC MODE #4 — Ownership Hands-Free Policy v3.5.8
## Objet: Automatisation complète wrapper `run-live-crypto-po.ps1` en mode "Owner Hands-Free" permanent

---

## 1. Constat Actuel (avant automation)

Commande actuelle du signataire, **INTERACTIVE / NON AUTOMATIQUE** aujourd'hui:
```
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-live-crypto-po.ps1 -Verbose
```

3 Blocages identifiés aujourd'hui:
1. **Aucun des 8 secrets minimal unblock set pré-chargés** → §Step1 $SecretsToInject tous `$null`.
2. **Aucun wrapper 1-clic** → exécuter la commande dans PS Admin, manuellement.
3. **Aucun fichier de configuration local persisté** (en dehors de CredMan Windows) → redémarrage = replay manuel.

Résultat aujourd'hui: Gate G1..G4 = tous FAIL → FAIL-CLOSED NOOP 0 rail.

---

## 2. Objectifs (OWNER_HANDS_FREE_POLICY)

| # | Objectif | SM/Requis |
|---|---|---|
| O1 | **Précharger 8 / 36 secrets minimal unblock set** depuis un fichier de config `.swarm/owner-hands-free.config.ps1` (signataire-owned, .gitignoré) | Required |
| O2 | **Wrapper Windows CMD 1-clic** double-clic, pas besoin de commande PS manuelle | Required |
| O3 | **Check-list 8 secrets** avant exécution wrapper. Si 0 secrets configurés → SORTIE 5 immédiate FAIL_CLOSED (pas d'exécution run-live-crypto-po.ps1) | Required |
| O4 | **Idempotence**: si secrets pré-chargés déjà en Process scope / User scope, ne pas overwrite (excepté si `FORCE_RELOAD_HANDSFREE=1`) | Required |
| O5 | **0 secrets leaked dans repo**: `.swarm/owner-hands-free.config.ps1` 100% gitignored, gitleaks PATTERN match exclusion local | Required |
| O6 | **NG6 préservé**: 0 `git push` dans wrapper. Seulement config + exec run-live-crypto-po.ps1 | Required |
| O7 | **NG2 Phone Rule permanent**: 0 preuve fichier fabriqué pendant wrapper exécution | Required |
| O8 | **NG7 FINAL MASTER zéro réutilisation**: redémarrage script = fresh ENTRIES calcul distribution | Required |
| O9 | **Doctrine FAIL-CLOSED G1-G4 préservée**: wrapper n'écrase PAS les règles du §Step1 §Gates run-live-crypto-po.ps1. Seulement complète l'injection. | Required |
| O10 | **Documentation "Signataire HowTo"**: Section dédiée dans spec + tâche T3 comment remplir 8 secrets (avec exemples DE PLACEHOLDERS vides — 0 valeurs en dur). | Required |

---

## 3. Architecture

### 3.1 Fichiers créés / modifiés

| Fichier | Type | Statut | Rôle |
|---|---|---|---|
| `.swarm/owner-hands-free.config.ps1` | PS1 config | NOUVEAU | 36 secrets ordered dict placeholder, **seulement les 8 minimal unblock set** sont commentés avec instructions. Signataire-owned. 100% gitignoré. |
| `.gitignore` | Git config | MODIFIÉ | Ajouter `.swarm/` (sauf si existant partiel) + expliciter `owner-hands-free.config.ps1` comme privé |
| `scripts/START-OWNER-HANDS-FREE.cmd` | Windows CMD wrapper | NOUVEAU | Double-clic 1-clic wrapper: admin self-elevation check, check prereq Node/PowerShell, dot-source la config `.swarm/owner-hands-free.config.ps1`, injecte 8 vars dans Process scope, valide count≥8 → **EXEC** `run-live-crypto-po.ps1 -Verbose`. Si count<8 → exit 5 FAIL_CLOSED avec message détaillé signataire. |
| `.trae/specs/owner-hands-free-v358/spec.md` | THIS FILE | Créé | Spec 10 AC 9 NFR 5 NG |
| `.trae/specs/owner-hands-free-v358/tasks.md` | Tasks | Créé (SP2 PLAN) | T0..T4 serial tasks |
| `.trae/specs/owner-hands-free-v358/review.md` | SP5 Review | Créé (SP5 REVIEW) | Review indépendant + 3 reserves (R1 signataire remplir config; R2 push NG6 hors trae; R3 PO delivery wait) |

### 3.2 Flow d'exécution `START-OWNER-HANDS-FREE.cmd`

```
[Step CMD Wrapper 1]
  Vérif Admin PS elevation? si NON → self-elevate avec -ExecutionPolicy Bypass -NoProfile -Verbose
    → fallback: écrire "Please run this file as ADMINISTRATOR" → exit 6
[Step 2]
  ROOT = resolve C:\...repo
  CONFIG_PATH = %ROOT%\.swarm\owner-hands-free.config.ps1
  If NOT exist CONFIG_PATH → "Signataire: copier template owner-hands-free.config.ps1 → remplir 8 secrets" exit 5
[Step 3]
  Dot-source CONFIG_PATH → variables $OWNER_HANDSFREE_SECRETS ordered dict
  Compte count = 8 minimal unblock set clés non-vides
  If count<8 → message détaillé "8 secrets minimal unblock set attendus: 1) DATABASE_URL len≥122 ... 8) RELEASE_AMOUNT_OVERRIDE_USD=60 → actuellement count=X<8 → FAIL_CLOSED" → exit 5
[Step 4]
  Copie 8+28 (36 total) vars dans Process scope via Set-Variable -Scope 2 -Name -Value ET $env:VAR_NAME
  Export-Clixml transient logs/tmp PS variable (environ sécurisé), NG6
[Step 5]
  & "$ROOT\scripts\run-live-crypto-po.ps1" -Verbose
  Capturer exit code LASTEXITCODE / $LASTEXITCODE
  Si LASTEXITCODE≠0 → "Wrapper terminé avec exit=$LASTEXITCODE, consulter logs/swarm_clickless/latest.json"
  Si LASTEXITCODE=0 → "Wrapper terminé: G1..G4 OK, payouts exécutés, POs traités, consulter reports/secrets-payouts/00_final_master.json"
[Step 6]
  FIN.
```

### 3.3 Contenu modèle `.swarm/owner-hands-free.config.ps1`
(SIGNATAIRE À REMPLIR, TOUS CHAMPS VIDES PAR DÉFAUT):
```powershell
# owner-hands-free.config.ps1 — SIGNATAIRE ONLY, 100% PRIVÉ, GITIGNORED.
# Remplir SEULEMENT les 8 minimal unblock set. 0 autres ont defaults dans run-live-crypto-po.ps1.
$OWNER_HANDSFREE_SECRETS = [ordered]@{
    # ================ 8 MINIMAL UNBLOCK SET (À REMPLIR PAR SIGNATAIRE) ================
    'DATABASE_URL'                    = ''   # 1. Neon Postgres PROD pooled URL len≥122 (ex: postgres://user:pass@pool...neon.tech/main?sslmode=require)
    'LIVE_BANK_API'                   = ''   # 2. 'true'
    'BINANCE_API_KEY'                 = ''   # 3. Spot Withdraw HMAC/Ed25519 key len≥32
    'BINANCE_API_SECRET'              = ''   # 4. Spot Withdraw Ed25519 secret len≥32
    'OWNER_EXEC_UNLOCK'               = ''   # 5. High-entropy HMAC key len≥43 (≥43 chars)
    'OWNER_HANDS_FREE_POLICY'         = ''   # 6. 'true'
    'CEX_DIRECT_DEPOSIT_ENABLED'      = ''   # 7. 'true'
    'RELEASE_AMOUNT_OVERRIDE_USD'     = ''   # 8. '60'  (string numérique)

    # ================ 28 AUTRES (default run-live-crypto-po.ps1, laisser vides) ================
    'SUPABASE_URL'                    = ''
    'SUPABASE_SERVICE_ROLE_KEY'       = ''
    'MIRROR_SUPABASE_BUCKET'          = ''
    'SECURE_CLOUD_PRESIGNED_URL'      = ''
    'GITLAB_MIRROR_REPO'              = ''
    'GITLAB_PAT'                      = ''
    'CODEBERG_MIRROR_REPO'            = ''
    'CODEBERG_SSH'                    = ''
    'LOCAL_MIRROR_DIR'                = ''
    'DOOMSDAY_ARCHIVE_PASSPHRASE'     = ''
    'PAYPAL_MODE'                     = ''
    'PAYPAL_CLIENT_ID'                = ''
    'PAYPAL_CLIENT_SECRET'            = ''
    'PAYPAL_WEBHOOK_ID'               = ''
    'PAYPAL_CIP_MA_CASE'              = ''
    'BANKING_CIRCLE_SDK_USER'         = ''
    'BANKING_CIRCLE_SDK_PASS'         = ''
    'BANKING_CIRCLE_SDK_ENDPOINT'     = ''
    'BANKING_CIRCLE_PSK'              = ''
    'WISE_API_KEY'                    = ''
    'WISE_PROFILE_ID'                 = ''
    'PAYONEER_ACCOUNT_ID'             = ''
    'PAYONEER_API_CLIENT_ID'          = ''
    'PAYONEER_API_CLIENT_SECRET'      = ''
    'ATTIJARI_CIB_USERNAME'           = ''
    'ATTIJARI_CIB_PASSWORD'           = ''
    'ETH_ARB_PROVIDER_URL'            = ''
    'OWNER_WALLET_ARB_0X'             = ''
}
```

---

## 4. Critères d'Acceptation (10 AC)

| AC # | Type | Règle / Rubrique | Niveau |
|---|---|---|---|
| AC-1 | rule | Fichier `.swarm/owner-hands-free.config.ps1` existe, **36** ordered keys listées EXACTEMENT (comparaison arrays 36/36 match) | Must |
| AC-2 | rule | `.gitignore` contient ligne `.swarm/**` OU `.swarm/` OU combinaison tel que `git check-ignore .swarm/owner-hands-free.config.ps1` → **code 0**, fichier ignoré | Must |
| AC-3 | rule | `scripts/START-OWNER-HANDS-FREE.cmd` existe, non-vide, contient auto-elevation Admin check, contient 8 minimal unblock set check count≥8 avant exec run-live-crypto-po.ps1 | Must |
| AC-4 | rule | **Mode PLACEHOLDER** (config encore vide): exécuter wrapper → **sortie exit code=5** AVANT exécution run-live-crypto-po.ps1. Capture message "FAIL_CLOSED count=0<8 minimal unblock set" | Must |
| AC-5 | rule | **Mode CONFIG_VALIDE (mock)** (simulation: vars DATABASE_URL=placeholder_len122…, UNLOCK=43 chars définies dans scope wrapper): run-live-crypto-po.ps1 appelé avec -Verbose, LASTEXITCODE propagé correctement par wrapper CMD → ne gèle pas 30s (timeout<10s ok mock). | Must |
| AC-6 | rule | NG6 PRESERVÉ: 0 occurrence `git push` dans wrapper CMD + config.ps1. Uniquement set-variable + & run-live-crypto-po.ps1. | Must |
| AC-7 | rule | NG2 PRESERVÉ: 0 fichier créé dans `out/received/` pendant wrapper exec (avant/après = mêmes count 0 non-gitkeep). | Must |
| AC-8 | rubric score 0/1/2 | Intégrité 36 key positionnelle: config.PS1 $OWNER_HANDSFREE_SECRETS.keys list = KNOWN_36_KEYS (scripts/t5-secrets-payouts-po-v358.mjs L124-175) 100% order match (index 0..35 OK). 2/2 = ordre+nom 36/36, 1/2 = noms OK ordre partiel, 0/2 = noms différents. | Must |
| AC-9 | rubric score 0/1/2 | Check List signataire HowTo (README-ish section tasks.md + spec.md O10) contient 8 items remplissage + 3 étapes. 2/2 = 8+3 trouvés, 1/2 = partiel, 0/2 = absent. | Should |
| AC-10 | rule | GLOBAL: wrapper CMD + config + .gitignore respectent doctrine FAIL-CLOSED, 0 fuite, 0 push, 0 fabrication, auto hands-free avec compte 8 secrets validés. | Must |

### NFR (9):
- NFR-1: wrapper Windows CMD, compatible PS 5.x (Win 10/11), pas besoin de PS 7.
- NFR-2: `$OWNER_HANDSFREE_SECRETS` structure `[ordered]@{}` pour préserver l'ordre 36 keys.
- NFR-3: 0 `echo` de valeurs plaintext dans wrapper stdout (seulement length affiché si Verbose).
- NFR-4: `maskSecret` pattern "prefix4…suffix2 len=NN" utilisé dans wrapper stdout Verbose mode.
- NFR-5: wrapper ne crée pas de variables Persistent User/Machine scope. Seulement **Process scope** (set-variable / $env:VAR — perdu à la fermeture du processus).
- NFR-6: Idempotent. Relancer 2× de suite = 2 exécutions indépendantes.
- NFR-7: Timeout total wrapper 1200s (20 min max) pour laisser run-live-crypto-po.ps1 terminer rail Binance + POs.
- NFR-8: Fichiers temporaires (s'il y en a) créés dans `%ROOT%/tmp/` avec auto-cleanup `finally` block.
- NFR-9: wrapper check Node.js 24.x disponible (`where node` → node -v v24.x) avant exécution.

### NG Global Binding 5 doctrines:
- NG1 0 write DB audit mode → **réservé à run-live-crypto-po.ps1 §Step1 Gates. Wrapper ne fait rien DB.**
- NG2 PHONE RULE 0 fabrication preuves → wrapper n'écrit rien dans `out/received/` ou `exports/bank-wire/`.
- NG3 0 huissier email → 0 smtp/nodemailer/send cmd.
- NG4 0 prisma modifications → wrapper ne touche pas schema.prisma/generate.
- NG5 zero-loss → calcul fait dans run-live-crypto-po.ps1 §deriveBalance, wrapper ne décompose pas $.
- NG6 NO GIT PUSH IN TRAE → wrapper n'appelle **JAMAIS** `git push` (seulement run-live-crypto-po.ps1 qui s'abstient aussi).
- NG7 0 stale FINAL MASTER → wrapper ne copie pas JSON d'une exécution précédente.

---

## 5. 5 Réserves anticipées SP5 (signataire-owned)

| R# | Gravité | Réserve | Condition levée |
|---|---|---|---|
| R1 | HIGHEST | Config placeholder 36/36 toujours vide (8 minimal unblock set = 0 / 8) → wrapper exit 5 FAIL_CLOSED | Signataire colle 8 valeurs dans config |
| R2 | HIGH | Admin PS non exécuté → wrapper exit 6 self-elevation request refusée | Signataire clic droit Run As Administrator |
| R3 | HIGH | NG6 push HORS Trae pas fait: commit locaux SHA **3a922be4** + nouveaux commit pas push remote | Admin PS HORS TRAE `scripts/push-outside-sandbox-v358.ps1` |
| R4 | MEDIUM | PO delivery 0 proof → status pending_proof permanent NG2 | Attendre livraisons physiques + fichiers POD:AMANA-sha256 |
| R5 | HIGH | PayPal CIP 401 PPP2 non résolu → Payoneer/PayPal rails 3-way grid SKIP | Dossier CIP MA-147672146951995880 résolu |

---

## 6. Signataire HowTo Remplissage 8 Minimal Unblock Set (O10 AC-9)

### Étape 1/3 — Préparer 8 valeurs (à obtenir hors repo)
```
1) DATABASE_URL                    : Console Neon → Project → Connection Pool → pooled URL len≈122
2) LIVE_BANK_API                   : 'true' (littéral string)
3) BINANCE_API_KEY                 : Binance API Management → SPOT Withdraw + Wallet Reading (HMAC/Ed25519) len≥32
4) BINANCE_API_SECRET              : Paire ci-dessus (Secret API, Ed25519 secret si Ed25519) len≥32
5) OWNER_EXEC_UNLOCK               : High-entropy ≥43 chars random, ex: openssl rand -base64 40
6) OWNER_HANDS_FREE_POLICY         : 'true' (littéral)
7) CEX_DIRECT_DEPOSIT_ENABLED      : 'true'
8) RELEASE_AMOUNT_OVERRIDE_USD     : '60' (texte ou nombre)
```

### Étape 2/3 — Coller dans fichier
```
Ouvrir →  .swarm/owner-hands-free.config.ps1
Coller chaque valeur dans les 8 '' (entre guillemets simples SANS espace)
Sauvegarder.
```

### Étape 3/3 — Exécuter wrapper 1-clic
```
🖱️ Double-Clic →  C:\repo\scripts\START-OWNER-HANDS-FREE.cmd
OU
Administrateur PowerShell HORS TRAE:
  cd "C:\Users\Dell\Downloads\Nouveau dossier (3)"
  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\START-OWNER-HANDS-FREE.ps1 -Verbose
```

*Fin SP1 SPECIFY OWNER HANDS-FREE v3.5.8 Policy*
