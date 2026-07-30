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
