# Swarm 2026-09-28 Remediation — Attijari Contentieux Addresses / Owner Receipts / PO Delivery

## Overview
Owner reports: "nothing received yet" at 2026-09-28 00:00 local Morocco. Three correlated workstreams are failing to close the loop between booked ledger entries (OwnerSettlement rows on Neon written S6 previous run) and real-world proof of receipt. The 3 gaps are:

1. **Attijari Contentieux addresses for RIB 182 (salary) + RIB 372 (debt):** Attijari Wafae wire rail uses `bankAddress` + `beneficiaryAddress` fields that currently live in hard-coded fallbacks. Neon `BankAccount` table does NOT exist on prod (39 tables only; confirmed in `neon-list-tables-353.mjs` run Sep 27 2026), so the code falls back to stub addresses — these must be authoritatively settable from the procurement address book (procurement.txt + data/procurement-requests.json already contain the owner family's physical MA addresses + CINs + tel). Attijari bank branches: 45 Avenue Ibn Sina Agdal Rabat = Contentieux/Traitement Rabat (batch IBAN → branch routing + SIRET/BIC code needed). Also, Bachir Tsouli is listed at L9 of procurement.txt with full address; Hind Tsouli Sidi-Yahya-Zair 12150 Casablanca; Younes Bouznika 13100.

2. **Swarm PO delivery gap:** 3 PO recipients registered in `data/procurement-requests.json`: Hind Tsouli (HT-001..005, 4547 MAD pending), Younes Tsouli (YT-001..011 ~14k MAD pending), Bachir Tsouli (BT-001..007 3302 MAD = the only one we actually closed Wafae TEMU WR-001..WR-007 7/7 settled — but it was a standalone TEMU batch on a separate file `temu.txt` and NEVER linked back to the canonical ProcurementItem rows for BT addresses. Owner sees "nothing received" → ProcurementItem.deliveryProofHash + ProcurementItem.receipts are empty because the 7 WR TEMU deliveries were written as Shipment rows, not propagated back to canonical PO recipients.

3. **Owner pre-set accounts "receipt gap" (banked spendability vs real deposited receipt):** Previous v3.5.3b run POST-S6 snap = totalSent $60,600.30 Δ +$840; spendable $311.25; completed=165 (+9 new rows written). But that is ONLY ledger writes on the spend side. The inbound revenue/receipt side — `RevenueEvent` table receipts, `SwarmAgentContext` SWARM_REVENUE_RECOGNIZED events, crypto/token incoming deposits, PayPal inbound capture events — has NOT been validated at all. Owner reports "nothing received yet" as the receive-leg of the flow (inbound revenues → owner settlements → payout → real-world bank deposit) has no inbound audit.

## Target Users
  a) **Owner (principal):** Wants real-world deposit notifications (Attijari statement lines for RIB 182/372 + BC646 wire confirmations + PayPal/Payoneer/USDC deposits), not only OwnerSettlement ledger rows.
  b) **Bachir / Hind / Younes Tsouli (PO recipients):** Want POs shipped to their procurement.txt addresses with Swarm-prepaid vendor checkout.
  c) **Autonomous tick / Base44 ops agent:** Needs durable ProcurementItem ↔ Shipment mapping so 3-way match works on canonical recipients, not only TEMU one-offs.

## Goals
G1. **Close Attijari Contentieux address book:** Wire OwnerAccount preset destination rows + new `attijari_address_book.mjs` with all 3 owner family CIN/tel/address fields pulled from procurement.txt for Attijari Contentieux Rabat (Agdal 45 Ibn Sina branch) + Casablanca + Bouznika, plus the bank BIC (BCDIMAMC for Attijari Wafae MA), branch code 18 = Rabat Agdal Contentieux.

G2. **Close PO delivery ↔ receipt audit loop:** For canonical PO recipients HT/YT/BT in data/procurement-requests.json: run the pipeline (pending→ordered→shipped→in_transit→delivered→receipt_confirmed→settled) end-to-end, propagating TEMU WR-001..WR-007 shipment proof back to the canonical BT ProcurementItem rows for Bachir L9 address. Run probe-item-statuses-353 first to get the current list of items missing receipts.

G3. **Close Owner inbound ↔ outbound audit loop:** Probe ALL RevenueEvent (inbound receipts) + OwnerSettlement (outbound payouts) delta. Show totalIncoming vs totalSent, per currency, per owner. Identify any orphan inbound receipts that never triggered an owner payout, and orphan outbound payouts that have no matching inbound RevenueEvent entitlement (guard against phantom payout leaks).

G4. **Re-release owner payout tick 2026-09-28:** autorun-owners-full-v353 (which enforces env propagation) reruns today's payout cycle with the SAME minute-floored idempotency, so any spendable newly arrived from inbound revenues since Sep 27 15:00 → released.

## Non-Goals
NG1. **No Prisma schema edits (NG1 pin):** FundBucket, BankAccount, Payout, OwnerPayment tables not deployable; keep fallback-only. No migrations. Add code-only JSON address book stored at `data/attijari-address-book-v354.json`. Idempotent reads via `fs.readFileSync + JSON.parse` instead of Prisma.

NG2. **No new external API/live call commits:** Addresses are read from procurement.txt addresses that already exist in the repository. No actual Attijari Contentieux SOAP/WS calls (requires banking API creds not present); this is a template/wire-payload generator only.

NG3. **No direct spend outside existing policy:** All payouts/POs MUST pass the 10/40/30/20 buckets + min-floored idem + OWNER_HANDS_FREE_POLICY='true' + OWNER_EXEC_UNLOCK≥16 + connectorStatus IN the allowlist.

NG4. **No git commit of env keys, values, or recipient PII beyond the already-committed procurement.txt addresses.** Keep `data/attijari-address-book-v354.json` in `.gitignore` if it adds new PII. If it simply re-exports addresses already in tracked files → track.

## Constraints
C1. Prisma 7 driver adapter ONLY (PrismaPg Pool). Bare PrismaClient crashes on Neon (502, route.ts defect already fixed).
C2. Procurement pipeline: pending→ordered→shipped→in_transit→delivered→receipt_confirmed→settled; 3-way match per item; SHA oracle proof; AuditLedger HMAC append-only.
C3. Bucket routing: 10% salary → RIB 182 MAD · 40% debt → RIB 372 MAD · 30% sovereign + 20% runtime → BC646 USD/EUR · procurement_buffer = runtime_balance × 50% auto-extend $0.15 held/$1 received.
C4. Idempotency refs minute-floored: `OWNER-AUTO:<RAIL>:sha256(id|:|r2(amt)|:|currency|:|bucketCode|:|(Date.now/60000|0))`.
C5. Owner profile Autonomy 100% hands-free: NO user prompts for authorization inside flows. All gates passed → proceed.

## Acceptance Criteria

### Rule ACs (binary pass/fail)
AC-R1. `scripts/probe-owner-pnl-354.mjs` exists. Must query Neon: `SELECT COUNT(*) FROM "RevenueEvent"` + sum(amount by currency) AS inbound; `SELECT COUNT(*) FROM "OwnerSettlement" WHERE status='completed'` sum(amount by currency) AS outbound. Outputs a table inbound vs outbound per owner, per currency. Exit 0.

AC-R2. `scripts/probe-owner-pnl-354.mjs` exits 0 → any row where `outbound_amount > inbound_amount + $200` per owner per currency → prints `⚠️ ENTITLEMENT GAP: ownerLabel X currency Y outbound Z vs inbound W`; BUT the flow proceeds (this is informational only, NOT a payout gate because revenues can be pending on the platform-side).

AC-R3. `scripts/attijari-address-book-v354.mjs` exists, reading `data/procurement-requests.json` + `procurement.txt` L1/L5/L9 addresses, emitting `attijariAddressBook { entries: [{ownerLabel, rib, address, tel, cin, branchCode, bic, fullWireTemplate}]}` for each of 3 physical RIB owners. Each entry includes Attijari BIC `BCDIMAMC`, bank `Attijari Wafae — Contentieux/Traitement` name. NO hard-coded or synthetic addresses beyond what already lives in tracked procurement files.

AC-R4. `scripts/bt-temu-proof-backlink-354.mjs` exists and queries Neon ProcurementItem with canonical BT (Bachir Tsouli L9 Agdal) recipient addresses; finds any rows with deliveryProofHash=null but matching 7 TEMU WR-001..WR-007 PO numbers / carrier tracking numbers in Shipment table. Per WR match, updates ProcurementItem via Prisma DML (UPDATE SET deliveryProofHash = Shipment.deliveryProofHash, receiptMediaReferences = ARRAY_APPEND, deliveryConfirmedBy = 'WR-' || ref, updatedAt = now()). Exit 0 on all 7 back-linked = 0 rows left unmatched.

AC-R5. `node scripts/autorun-owners-full-v353.mjs` runs exit 0 with all 3 env vars (OWNER_HANDS_FREE_POLICY=true, AUTO_CONFIRM_OWNER_BATCHES=true, DAEMON_HANDS_FREE_TICK=1) propagated. POST-final snap probe-payout-readiness-353 shows `processing ≤ 1` and `totalSent ≥ $60,600.30` (Δ today > 0 if new inbound revenue arrived; otherwise identical=idem PASS). NO double-charge: totalSent must NOT grow > $61k without matching RevenueEvent inbound.

AC-R6. `npx tsc --noEmit exit 0` after all edits. `npx vitest run 189/189`. `git diff prisma/schema.prisma EMPTY`.

### Rubric ACs (evaluative)
AC-E1. **Receipt Audit coverage (0-2):** 2 = inbound RevenueEvent rows all correctly attributed to owner label + PO SKUs all matched 100%; 1 = >75% attribution; 0 = <50%.

AC-E2. **Attijari Wire Template Correctness (0-2):** 2 = 3 templates (Agdal Rabat Contentieux + Casablanca Sidi-Yahya + Bouznika) match actual owner addresses; no synthetic PII; BIC/branchCodes validated against Attijari public routing tables. 1 = >1 template correct. 0 = no templates.

AC-E3. **PO Back-link Correctness (0-2):** 2 = all 7 TEMU WR-001..WR-007 items now have deliveryProofHash propagated back to canonical ProcurementItem rows for Bachir L9; probe-item-statuses-353 shows "0 items missing receipt on BT scope". 1 = 4-6 items. 0 = <3.
