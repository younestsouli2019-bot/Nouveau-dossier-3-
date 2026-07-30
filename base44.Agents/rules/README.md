# Base44 Swarm Rules

## Revenue Pipeline
- All revenue must go through orchestrator for circuit breaker check
- Earnings are classified by morocco-tax-compliance for regime tracking
- Settlements respect 10/40/50 allocation from owner-truth.json
- Observe mode is default; SWARM_LIVE=true enables real fund movement

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

## Secure Cloud & Continuity
- All site assets in content/ MUST be mirrored to at least 2 active CDN nodes
- Mirror health is checked every 30s; failover triggers at 5s timeout
- Encrypted cold storage backup runs nightly (zstd compressed, aes-256-gcm encrypted)
- Restore drills execute every Monday 08:00 UTC; proof stored in data/swarm/continuity/
- RED-level outage auto-triggers restore from encrypted backup via secure-cloud module
- Encryption keys stored in environment variables (never in repo)
- Circuit breaker from contingency engine halts ALL payouts if mirror health drops below threshold
