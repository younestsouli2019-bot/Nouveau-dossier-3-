# Swarm 2026-09-28 Remediation — Implementation Tasks

AC coverage map:
- AC-R1, AC-R2 → Task 1 (Owner PnL probe: inbound vs outbound audit)
- AC-R3 → Task 2 (Attijari address book / wire templates)
- AC-R4, AC-E3 → Task 3 (TEMU WR back-link to canonical ProcurementItem)
- AC-R5 → Task 4 (Owner payout tick rerun)
- AC-R6 → all tasks
- AC-E1 → Task 1
- AC-E2 → Task 2

## Task 1: Owner PnL audit inbound (RevenueEvent) vs outbound (OwnerSettlement)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: none
- **Description**: Create `scripts/probe-owner-pnl-354.mjs` with PrismaPg dotenv + Prisma 7 adapter pattern (see probe-payout-readiness-353 L1-24). Query:
  (a) `SELECT "ownerId", "ownerLabel", currency, status, "connectorStatus", COUNT(*) as rows, SUM(amount) as amount FROM "OwnerSettlement" GROUP BY 1,2,3,4,5 ORDER BY 2,3;` — outbound payouts per owner.
  (b) `SELECT "currency", "status", "rail" as src, COUNT(*) rows, SUM("amountNet") as netIn, SUM("amountGross") as grossIn FROM "RevenueEvent" GROUP BY 1,2,3;` — inbound receipts.
  (c) For each ownerAccountId, compute entitlement gap = SUM(OwnerSettlement WHERE completed) - SUM(RevenueEvent WHERE verified). Print ENTITLEMENT GAP warning if abs(gap) > $200 (AC-R2 informational). Exit 0 always.
- **Test Requirements**:
  - rule TR-1.1: `npx tsx scripts/probe-owner-pnl-354.mjs | Select-String -Pattern "ENTITLEMENT GAP"` → informational; exit code === 0.
  - rule TR-1.2: probe-owner-pnl-354 does NOT use bare `new PrismaClient()`, only PrismaPg adapter. grep `PrismaPg|PrismaClient({adapter` → ≥1 hit.
  - rubric AC-E1: see spec; score evidence in Completion Evidence.

## Task 2: Attijari Contentieux address book + wire templates from procurement addresses
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (informational, no code coupling)
- **Description**: Create `scripts/attijari-address-book-v354.mjs`. Inputs: (a) parse `data/procurement-requests.json` recipients, (b) parse `procurement.txt` L1 Hind, L5 Younes, L9 Bachir addresses with regex.
Outputs: (i) stdout array of wire template entries, (ii) write JSON to `data/out/attijari-address-book-v354.json` (gitignore-friendly, not committed unless empty of new PII). Each entry contains: ownerLabel, rib (RIB code 594182 for salary 182; 00029 for RIB 372; 646 for Banking Circle branch in Lux), bankName ("Attijari Wafae — Contentieux/Traitement Rabat Agdal"), bic="BCDIMAMC" (Attijari Wafae MA BIC), branchCode, address, tel, cin, fullWireTemplate (MT103-like text block for SWIFT copy/paste). Routing: Bachir/Ibn Sina/Rabat = branchCode=018 Rabat Agdal; Hind Sidi-Yahya = branchCode=010 Casablanca centre; Younes/Bouznika = branchCode=045 Settat.
- **Test Requirements**:
  - rule TR-2.1: `npx tsx scripts/attijari-address-book-v354.mjs 2>&1 | Select-String "BCDIMAMC" | Measure-Object | % Count` ≥ 3 (all MA entries have BIC).
  - rubric AC-E2: score 0/1/2 and paste output of attijari script into Completion Evidence.

## Task 3: Back-link TEMU WR-001..WR-007 shipment proof → canonical ProcurementItem BT rows
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 informational only
- **Description**: Create `scripts/bt-temu-proof-backlink-354.mjs`. Steps:
  (a) SELECT all ProcurementItem rows whose address/deliveryTo text contains "Bachir Tsouli" or "45 Avenue Ibn Sina Agdal Rabat"; keep those with deliveryProofHash IS NULL or receipt_status != 'receipt_confirmed'.
  (b) SELECT from "Shipment" WHERE referenceId LIKE 'WR-00[1-7]%' OR carrier LIKE '%TEMU%' OR trackingNumber IS NOT NULL; LEFT JOIN ShipmentEvent ON shipment.id=shipmentId WHERE eventType='delivered' OR eventData LIKE '%receipt%'.
  (c) For each WR ref found, match against BT ProcurementItem by closest SKU / price MAD / description (WR-001=Women Trench 199 MAD; WR-002=Plaid Skirt; WR-003=Bag; WR-004=Dress 149; WR-005=Long Dress 179; WR-006=Short Set 169; WR-007=Yellow Trench 199). Update ProcurementItem SET deliveryProofHash = shipment.proofHash, receipts = COALESCE(receipts, '{}') || shipment.receiptData::jsonb, receipt_status = 'receipt_confirmed', updatedAt = now() WHERE id = matchedRow.id.
  (d) Print summary: "Back-linked N of 7 TEMU WR deliveries → canonical BT ProcurementItems."
- **Test Requirements**:
  - rule TR-3.1: `npx tsx scripts/bt-temu-proof-backlink-354.mjs 2>&1 | Select-String "Back-linked"` → prints ≥ "Back-linked 5 of 7". Script exit 0.
  - rule TR-3.2: After back-link, rerun probe-item-statuses-353 → BT scope missing ≤ 2.
  - rubric AC-E3: score from probe-item-statuses output.

## Task 4: Owner payout daemon tick rerun 2026-09-28 + payout matrix POST probe
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**: Run `node scripts/autorun-owners-full-v353.mjs` (wrapper already enforces env vars). POST-run: re-execute probe-payout-readiness-353.mjs to capture ΔtotalSent, new completed rows count (should be idempotent if no new inbound revenue). Print line `FINAL totalSent=$X completed=Y processing=Z held=$H spendable=$S`.
- **Test Requirements**:
  - rule TR-4.1: autorun exits 0.
  - rule TR-4.2: POST totalSent ≥ $60,600.30 (idem or growth OK; never shrink — that would indicate ledger bug). processing ≤ 1 (keeps orphan 120 MAD debt_repayment row from v3.5.2; see summary).

## Task 5: Quality gates + CHANGELOG + commit + SHA verify
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Tasks 1-4
- **Description**: (1) tsc --noEmit, (2) vitest run ≥189/189, (3) git diff prisma/schema.prisma EMPTY. (4) Prepend CHANGELOG section "2026-09-28 Attijari + PO receipt audit + owner tick rerun" summarizing results. (5) git add: spec artifacts + scripts + CHANGELOG only; EXCLUDE data/out logs, reports, .env. (6) commit, push, SHA EXACT MATCH LOCAL=REMOTE.
- **Test Requirements**:
  - rule TR-5.1: tsc 0, vitest 189/189, schema empty.
  - rule TR-5.2: SHA match exact post push.
