# Base44 Swarm Rules

## Revenue Pipeline
- All revenue must go through orchestrator for circuit breaker check
- Earnings are classified by morocco-tax-compliance for regime tracking
- Settlements respect 10/40/50 allocation from owner-truth.json
- Observe mode is default; SWARM_LIVE=true enables real fund movement

## Class A Receivables
- EVERY revenue-generating swarm mission (types: marketing, market_research, store_setup, financial_setup, content_creation) requires a Class A receivable
- Class A = 3-way reconciliation MATCHED + counterpartyAck + gatewayLedger + oracleConfirmed; partial evidence = Class B; unmatched/quarantined = Class C
- Revenue engines register missionId (default: umbrella mission 68c73bbe3efa5daf0a6709aa) so earnings map to swarm missions
- Receivables are persisted to data/settlement/receivables.json (included in settlement seal scope)
- NON-Class-A receivables from revenue missions are BLOCKED from settlement — no escrow release or net settlement until reclassified Class A
- Audit: `settlement:receivables:audit` (settlement.mjs receivables-audit) lists every revenue mission lacking Class A coverage; status MUST be ALL_REVENUE_MISSIONS_COVERED before payouts
- Net revenue settlement via `settlement:revenue:settle [rail]` nets only ELIGIBLE Class A receivables per currency; blocked receivables are quarantined and reported

## Morocco Revenue Rails & Netting
- Supported rails: ach, sepa, swift, usdc, eurc, sahl, ma_openbanking, charipay, payzone, xs2a
- Morocco plug-and-play gateways (small business / auto-entrepreneur friendly): Chari Pay (`charipay` rail), Payzone (`payzone` rail), Sahl (`sahl` rail)
- EU multibanking/PSD2: adorsys XS2A `open-banking-gateway` via `xs2a` rail
- All rails follow the same contract (init/initiatePayment/getPaymentStatus/verifyAccountOwnership/status); dry-run by default, env-configured, whitelist-checked against owner-truth.json
- Rail config env: `<RAIL>_API_URL[_SANDBOX]`, `<RAIL>_API_KEY`, `<RAIL>_CLIENT_ID`, `<RAIL>_CLIENT_SECRET`, `<RAIL>_DRY_RUN` (e.g. CHARIPAY_API_KEY, PAYZONE_API_KEY, XS2A_API_KEY)
- Revenue netting (`settleReceivables`/`netReceivables`) groups ELIGIBLE Class A receivables per currency into batches routed through the selected rail adapter

## Identity & Access
- Only CIN A337773 (Younes Tsouli) may authorize payouts
- All destinations must be in owner-truth.json allowedRecipients
- NO third-party intermediaries (SBDS-1.0)
- Yacine Tsouli is NOT_OWNER — cannot receive payouts

## Circuit Breakers
- outboundPayouts: 3/min threshold
- newDestinations: 2/day threshold
- authSystem: 5/15min threshold
- balanceManagement: 30% drop threshold
- CRITICAL threats trigger automatic global freeze

## Anti-Censorship & Doomsday Vault
- ALL 7 network layers MUST be maintained: clearnet-cdn, onion, i2p, ipfs, cold-storage, gh-pages, doomsday-vault
- If >= 2 clearnet mirrors go dark simultaneously → automatic CENSORSHIP_BLOCK escalation to contingency → failover cascade to onion/i2p/IPFS
- Tor onion service and I2P eepsite must be synced at least every 6h, IPFS every 4h
- Doomsday vault snapshots run daily: encrypt all content/assets with split-key (5 shares, 3 required for restore)
- Geo-replicas maintained in 3 independent jurisdictions (EU, US, APAC) — any single jurisdiction loss must not prevent full restore
- Vault integrity verified every 24h via sha256 manifest; 3 consecutive failures trigger CRITICAL escalation
- Quorum restore requires minimum 3 of 5 key shares — no single point of failure
- Encrypted backup files carry embedded sha256 checksum for tamper detection on decrypt

## Settlement Vault & Continuity
- data/settlement/ (immutable ledger blocks, escrow, quarantine, dids, settlements, receivables) MUST be sealed daily via `settlement-seal` — encrypted with split-key shares, checksum-per-asset
- Settlement seal runs ledger integrity verification first; any chain violation or failed seal escalates HIGH to contingency
- Mirror `mirror-settlement-data` (cold-storage, 2h sync, s3://rwc-doomsday-eu/settlement) carries encrypted settlement data
- Vault snapshots include settlement scope by default; `vault-snapshot --content-only` excludes it
- Full restore of settlement data requires decrypting sealed assets and re-verifying ledger chain integrity

## Secure Cloud & Continuity
- All site assets in content/ MUST be mirrored to at least 2 active CDN nodes
- Mirror health is checked every 30s; failover triggers at 5s timeout
- Encrypted cold storage backup runs nightly (zstd compressed, aes-256-gcm encrypted)
- Restore drills execute every Monday 08:00 UTC; proof stored in data/swarm/continuity/
- RED-level outage auto-triggers restore from encrypted backup via secure-cloud module
- Encryption keys stored in environment variables (never in repo)
- Circuit breaker from contingency engine halts ALL payouts if mirror health drops below threshold
