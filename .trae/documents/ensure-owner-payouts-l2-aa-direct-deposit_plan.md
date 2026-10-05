# Ensure Owner Payouts via L2/Account Abstraction + CEX Direct-Deposit Implementation Plan

## Contexte opérationnel (Financial Supervisor Phase 2 — CADRE 4)
User request (2026-10-05) : *"ensure revenues sent to OWNER pre-set accounts, many routes available"* avec 3 axes d'optimisation **réduisant le coût de gas de 95%+ pour les 6 preset owners** (RIB182/RIB372/BC646/PayPal/Payoneer/USDC-Arbitrum) :
1. **ERC-4337 Paymasters** : Payer les frais de gas L2 directement en stablecoin USDC/USDT (pas besoin de ETH/ARB natifs).
2. **Zero-Gas L2 Ecosystems** : Immutable X (gaming/NFT) + Loopring (ZK-DEX L2) zéro gas user.
3. **CEX Direct Deposits → L2** : Retrait USDC DIRECT depuis Binance/Coinbase/Bybit/Bitget **vers Arbitrum One** → **pas de pont L1→L2 coûteux**, ~$0.005 de frais (Binance) au lieu de $5-50 L1 bridge gas.
4. **Bonus contractuel** : POs (Purchase Orders) doivent aussi être livrés (fail-closed 166 gaps préservés v3.5.5 — 0 fabrication, 0 DB write sur ProcItem/Shipment).

---

## Repository Research (conclusions)
### Architecture crypto rails actuelle
- **`src/crypto/crypto-rail.mjs` → CryptoRailManager** ([L221-L429](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/crypto/crypto-rail.mjs#L221-L429)) :
  - 3 providers supportés : `binance (via @binance/connector installé v3.5.7)`, `bybit (ccxt)`, `bitget (ccxt)` — TOUS avec `network: "BSC"` codé en dur.
  - **ZERO support Arbitrum / Immutable / Loopring** → 1er blocage.
  - `submit()` a un param `providers` mais pas `network` → 2e blocage.
  - `resolveOwnerDestination()` ne lit que les env BEP20/ERC20 Trust Wallet → n'utilise PAS le walletAddress du preset owner DB `USDC on Arbitrum (0xA46225a…Efe7)` (seed-pos.mjs L94) → 3e blocage.
- **`scripts/owner-payout-evm.mjs`** ([L1-L100](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/scripts/owner-payout-evm.mjs#L1-L100)) :
  - Déjà 5 chaînes EVM supportées : base (prio1), **arbitrum (prio2)**, optimism, polygon, bsc → **Arbitrum 42161 + USDC 0xFd08… existent déjà.**
  - Mais sélectionne la chaîne avec `selectChain()` qui requiert **native ETH/BNB balance > 0.0001** → bloque les wallets sans gas natif → **cas d'usage ERC-4337 Paymaster manquant.**
- **`src/lib/treasury/release-engine.ts` → resolveRail()** ([L69-L105](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L69-L105), v3.5.7 patché) :
  - Route par IBAN pour les banques, mais **aucun routing explicit owner.accountType === 'l2_crypto' → network = Arbitrum + useDirectCexRail=true.**
- **Scripts autorun inventory 16 rails** (autorun-owners-full-v354.mjs L31) : Manquent les clés Paymaster / Immutable / Loopring / Direct-Deposit CEX scope.
- **Préset owners actifs (v3.5.6 snaps) :** 6 comptes, **le preset `USDC on Arbitrum` accountType l2_crypto a walletAddress 0xA462… défini mais jamais utilisé dans CryptoRailManager (routing BSC par défaut).** → 4e blocage (fonds credited inbound mais payout routed vers BSC, pas vers le preset L2).

### Contraintes dures (préservées 100% — NG1 + fail-closed doctrine)
1. **NG1 : 0 diff `prisma/schema.prisma`**. Aucune migration, aucun FundBucket upsert.
2. **Fail-closed OwnerSettlement.status='completed'** (trigger PostgreSQL) : nécessite (a) `externalRef` ≥6 chars non-synthetic (pas `PB-*`, `RECOVERY-*`) ; (b) `dataSource` ≠ `internal_ledger_only` ; (c) `proofHash` non-null ou `connectorStatus ∈ {live, verified, manual_attested_finance,…}`.
3. **Idempotence :** 1000 reruns donnent DB identique. Refs AutoRef floored par minute (buildAutoRef v3.5.4).
4. **Split 10/40/30/20 STRICT** (salary 10% RIB182 / debt 40% RIB372 / sovereign 30% + runtime 20% = 50% BC646 USD ou USDC-Arbitrum selon rail préféré).
5. **Autorun S0..S6 :** LIVE_BANK_API 4/16 → ΔtotalSent $0, spendable inchangé, processing ≤1. 8+ secrets = release externe réel.
6. **POs :** 0 fabrication, 0 touch ProcItem/Shipment/Receipt tables, 166 gaps préservés (user "hesitate to phone Hind Bachir Wafae").

---

## Files and Modules (liste des fichiers modifiés — scope fermé)
| Fichier | Changement prévu |
|---|---|
| `src/crypto/crypto-rail.mjs` | Ajout 3 nouveaux networks (Arbitrum One / Immutable zkEVM / Loopring L2) ; param `network` ajouté à `submit()` et `checkRails()` ; `resolveOwnerDestination` fallback → DB owner preset walletAddress si env vide ; `try/catch` autour network Bybit "ARBI" fallback BSC |
| `src/crypto/binance-client.mjs` | Helper `withdrawUSDCArbitrumDirect({address,amount,name})` = `withdraw(coin:"USDC", network:"ARBITRUM", …)` — utilise déjà `withdraw()` générique existant ([L59-L79](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/crypto/binance-client.mjs#L59-L79)) |
| `scripts/owner-payout-evm.mjs` | Ajout `USE_ERC4337_PAYMASTER` mode ; chaînes ImmutableX + Loopring ; sélection de chaîne via `ERC4337: true` si pas de native gas. Mode Paymaster public Pimlico/Stackup + Permit2 allowance USDC pour sponsor gas |
| `src/lib/treasury/release-engine.ts` | Routing explicit pour `owner.accountType === 'l2_crypto' && owner.network === 'Arbitrum' → rail: l2_usdc_arbitrum, useDirectCexRail: true, preferredNetwork: 'arbitrum'` ; commentaires AC-10/TR-2.1 |
| `scripts/auto-run-v354-owner-payouts.ts` | mapBucket L37 : `accountType 'l2_crypto' → bucket: 'sovereign_reserves'` garde mais **ajout d'un 2e routage dual BC646 OU USDC-Arbitrum selon `preferredRail` du owner preset** ; S3/S5 skip affiche le rail choisi |
| `scripts/autorun-owners-full-v354.mjs` | Inventory rail keys étendu 16 → 23 : + PIMLICO_API_KEY / STACKUP_PAYMASTER_RPC / USE_ERC4337_PAYMASTER / IMMUTABLE_API_KEY / LOOPRING_API_KEY / LOOPRING_ACCOUNT_ID / CEX_DIRECT_DEPOSIT_ENABLED. Toujours `len + mask only`, NO values echoed. |
| `CHANGELOG.md` | Prepend section `v3.5.8 (L2+AA+DirectDeposit)` avec root causes + optimisations + gates table + delta (BC646 ↔ USDC-Arbitrum rail choice) + push runbook permanent. |

**NON MODIFIÉS (NG1 + fail-closed) :** `prisma/schema.prisma` (0 diff), tables ProcItem/Shipment/Receipt (166 gaps intact), `trunk.yaml`, `.gitignore`.

---

## Implementation Steps (ordre de dépendance — 8 steps)
1. **[Step 1 — CryptoRailManager network + preset wallet resolution]** Modifier `crypto-rail.mjs` :
   - Ajouter const `SUPPORTED_NETWORKS = ['BSC','ARBITRUM','IMMUTABLEX','LOOPRING']`
   - Param `network` optionnel ajouté à `submit({..., network = 'AUTO'})`
   - `AUTO` heuristic : Si le owner preset match (accountType='l2_crypto') → préférer 'ARBITRUM', sinon 'BSC' compat ascendante.
   - `resolveOwnerDestination()` : Si `process.env.OWNER_CRYPTO_L2_ADDRESS` → utiliser, sinon fallback `process.env.USDC_L2_WALLET_ADDRESS` (nouvelle env var pointant preset USDC on Arbitrum 0xA462…).
   - `checkRails()` retourne aussi `networks` list + `directDepositEnabled: true/false` pour Binance (ARBITRUM withdraw allowed vérifié via `fetchDepositWithdrawFee(USDT, network:ARBITRUM)` dans bybit/bitget).
   - `binance/bybit/bitget submit` : Si network='ARBITRUM' → `params.network='ARBITRUM'` Binance ; ccxt bybit/bitget `{network:'ARBITRUM'}` + try/catch si échec → retry network='BSC' (fail-closed).
2. **[Step 2 — Binance client helper Arbitrum Direct]** Ajouter `withdrawUSDCArbitrumDirect` dans `binance-client.mjs` (wrapper 4 lignes autour de `withdraw(coin: "USDC", network: "ARBITRUM")`). Print `arb-direct:true` dans rail-health-probe.
3. **[Step 3 — owner-payout-evm.mjs ERC4337 + ZeroGas chains]**
   - Ajout 2 chaînes dans `CHAINS` : `immutablex {chainId:13371, rpc:'https://rpc.immutable.com', nativeSymbol:'IMX', usdc:'0x7eA4…', usdtDec:6, priority:6}` + `loopring {chainId:1101, rpc:'https://rpc.loopring.network', nativeSymbol:'ETH', usdc:'0x9A35…', priority:7}` (zéro gas user car sponsorisé protocole).
   - Mode ERC-4337 : Si `USE_ERC4337_PAYMASTER=true` OU si `nativeBal < 0.00001` → utiliser `ethers` `JsonRpcProvider` avec `PIMLICO_API_KEY` (endpoint `https://api.pimlico.io/v2/42161/rpc?apikey=...`) pour envoyer UserOperations. Permit2 `approve` sur USDC pour allowance paymaster avant envoi.
   - `selectChain()` accepte maintenant `usePaymaster: true` comme alternative à la balance native (fallback : si paymaster échoue, erreur explicite, pas de silent fabric).
4. **[Step 4 — release-engine.ts routing l2_crypto → Arbitrum Direct]**
   - Bloc `if (owner.accountType === 'l2_crypto' || (owner.label?.toLowerCase?.().includes('arbitrum') || owner.label?.includes('USDC')))` :
     - Retour `{ iban: owner.walletAddress || owner.accountNumber, name: owner.accountHolder, railClass: 'L2_CRYPTO_DIRECT_CEX', preferredNetwork: owner.network || 'arbitrum', directDepositHint: "Use CEX Direct-withdraw to skip L1 bridge gas" }`
   - Commentaire "(AC-10 rule, Owner L2 preset routing via CEX direct deposit, no L1 bridge gas cost — TR-4.1)".
5. **[Step 5 — autorun S3/S5 + autorun inventory 23 keys]**
   - `auto-run-v354 mapBucket` keep sovereign routing mais ajoute champ `preferredRail` return à `mapBucket()` pour l2_crypto. S3/S5 `releaseOwnerFunds` appel avec `{preferredNetwork}` si disponible.
   - Autorun inventory `rail_env present: X/23` avec 7 nouvelles clés listées ci-dessus. Vérification `len > 0 && value.startsWith('sk-')? mask: '…'` pour PIMLICO key — PAS de valeur brute echo.
6. **[Step 6 — Fix autorun v3.5.7 bucket conflation residual check]** Vérifier S6 POST snap que `debt_repayment` bucket RIB372 multiplier 40 appliqué (identique v3.5.7 — no regression).
7. **[Step 7 — Changelog v3.5.8 prepend]** Section complète avec : contexte Financial Supervisor, 3 axes optim, fichiers modifiés, gates tableau, rail inventory 4/23 (même 4 keys partial → LIVE_BANK_API true + ATTIJARI + PAYPAL + @binance connector chargé). Push runbook outside-sandbox identical v3.5.7.
8. **[Step 8 — Quality Gate finales]** Toutes passent avant d'invoquer NotifyUser.

---

## Dependencies and Considerations
- **@binance/connector** DÉJÀ installé v3.5.7 (122 packages) — pas de nouvelle dépendance.
- **ethers.js** DÉJÀ présent dans node_modules (owner-payout-evm.mjs l'utilise) — pas de new package pour ERC-4337 si on utilise Pimlico public RPC via standard ethers bundler calls.
- **Permit2 ABIs :** Inline hex minimal ERC20 `approve(address spender, uint256 value)` déjà dans `ERC20_ABI` on L48-52 — suffit pour allowance Paymaster.
- **Bybit / Bitget network naming :** Certaines versions ccxt utilisent "ARBI" au lieu de "ARBITRUM". Step 1 met un `try/catch` sur "ARBITRUM" → si échec, essaie "ARBI" → si échec, retombe sur BSC (compat ascendante). Résultat partiel imprimé explicitement dans `attempts[]`.
- **Pimlico public key / Stackup :** Ces services ont des rate limits sur les free tiers. Le mode `USE_ERC4337_PAYMASTER` utilise une queue de 1 UserOperation / 15 secondes (respect rate limit).
- **Risk "catch vide" :** Aucun `catch {}` vide ajouté. Tous les catches retournent `{ok:false, error: e.message}` ou écrivent AuditLedger.

---

## Validation (gates — identiques v3.5.7 standards)
| Gate | Critère | Commande / méthode |
|---|---|---|
| G1 TypeScript | `tsc --noEmit` exit 0 | `npm run typecheck` |
| G2 Prisma schema | Valid + 0 diff NG1 | `npx prisma validate` ; `git diff prisma/schema.prisma \| Measure-Object -Line` == 0 |
| G3 Vitest | **≥ 193 passed (v3.5.7 basse), 0 fails tolerés** | `npx vitest run --reporter=default \| Select-Object -Last 20` |
| G4 Rail-health probe runtime | Crash 0 ; Wise/PayPal/Crypto tous 3 exécutés ; Crypto rails retournent `networks: ['BSC','ARBITRUM', ...]` | `node scripts/rail-health-probe.mjs` exit code 0 ou 1 (partial attendu) mais 0 crash + 0 UV_HANDLE_CLOSING |
| G5 Autorun S0..S6 | Stages OK, ΔtotalSent $0, processing ≤1, rail inventory 4/23 affiché len+mask only | Dry run autorun wrappé PowerShell `OWNER_HANDS_FREE_POLICY=true process.env assign before exec` (pas de LIVE_BANK_API full 8+ → Δsent=0 correct fail-closed) |
| G6 GetDiagnostics IDE | 0 files, 0 diagnostics | IDE GetDiagnostics tool |
| G7 PO Gap integrity | SELECT ProcItem statuses delivered_count / receipt_confirmed_count identique v3.5.7 = 166 pending (no DB mutation) | `scripts/po-receipts-failclosed-audit-v355.mjs` exit 0 — 0 writes confirmé |

---

## Risks et handling
| Risque | Gravité | Mitigation |
|---|---|---|
| **Binance retire support withdraw USDC → Arbitrum** | Moyen ($0.25 fee BSC fallback) | `attempts[]` imprime explicitement fallback reason ; autorun S5 skip affiche + AuditLedger FINAGENT_L2_UNSUPPORTED |
| **ERC-4337 Paymaster Pimlico down / rate limit** | Moyen (goto native gas wallet) | Mode ERC4337 retourne `paymaster_down` code clair, n'essaie pas de fabric tx ; user notifié via `maybeSendAlert` |
| **CCXT Bybit Bitget network "ARBI" mismatch** | Faible | Try/catch → "ARBI" puis "BSC" 2 fallback ; attempts journalisés |
| **Autorun inventory new keys echo accidental** | Critique (fuite secret) | Inventory utilise MÊME mask() helper que v3.5.4/5/6 — mask len+4 first prefix, NO raw value, PAS de `console.log(key raw)` |
| **NG1 broken prisma edit** | Bloquant (spec mode reject auto) | G2 gate 0 diff obligatoire avant NotifyUser / commit. Prisma validate valid required. |
| **PO fabrication** | Critique Contentieux preuve | G7 integrity gate po-failclosed-audit script. 0 writes obligatoire — si le script écrit 1 row → rollback fichiers modifiés |
