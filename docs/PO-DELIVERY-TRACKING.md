# PO delivery tracking — exact shape the fail-closed engine expects

Source of truth: `scripts/lib/po-delivery.mjs` (read 2026-10-29). Runtime file:
`data/out/po/carrier-tracking.json` (override with `PO_CARRIER_TRACKING_FILE`).
`data/out` is gitignored — payout artifacts stay out of public repos; only the
template in `docs/templates/` is versioned.

## 1. Tracking file shape

```json
{
  "<PO_REF>": { "carrier": "<authorized>", "trackingNumber": "<real>", "events": [] }
}
```

- Root must be a JSON **object keyed by PO reference** (an array fails closed,
  code `PO_GUARD_BAD_TRACKING_FILE`).
- `carrier`: one of **AMANA, FORCELOG, CHRONO_DIALI, CATHEDIS, ARAMEX, DHL,
  FEDEX, UPS** (`AUTHORIZED_CARRIERS`). Matching is prefix-based after
  upper-casing and turning spaces/hyphens into `_`, so `"Amana Express"` →
  `AMANA`, `"chrono diali"` → `CHRONO_DIALI`.
- `trackingNumber`: at least 6 characters, and **not** one of the rejected
  placeholders: `unknown, na, n/a, null, none, tbd, todo, placeholder, xxx…,
  test, fake, dummy, sample` (code `PO_GUARD_NO_TRACKING`).
- `events`: optional array of carrier scan history. Drives status
  `label_created` (no events) → `in_transit` (events present) → `delivered`
  (only with a POD, below).

**Poste Maroc is NOT an authorized carrier.** `normalizeCarrier("POSTE MAROC")`
returns `null`, so a Poste Maroc tracking number can never validate. If a
parcel travelled with them, record the carrier that actually signed the
delivery note, or amend `AUTHORIZED_CARRIERS` deliberately (policy change —
the list comes from `po-gaps-v358.md §2`).

## 2. Proof of delivery (the human step)

`computeReceiptPod({ receivedDir, poRef, carrier })`:

- `receivedDir` (default `data/out/po/received`) must exist — a **flat**
  directory, not per-PO subdirectories.
- Filename must contain the PO ref (upper-cased) **and** the carrier name;
  fallback match is carrier name alone. Extensions: `pdf, jpg, jpeg, png, tif,
  tiff, webp`. Example: `SWARM-PO-2026-001-AMANA-signed.pdf`.
- POD ref is derived: `POD:<CARRIER>:<sha256 of the file>` — a locally
  computed hash with no external anchor is treated as synthetic and rejected
  (`isSyntheticProof`), so the scan must be the carrier's real printed,
  recipient-signed delivery note.
- Missing scan → `PO_GUARD_NO_RECEIPT_SCAN`; missing dir →
  `PO_GUARD_NO_RECEIVED_DIR`. Delivery stays unconfirmed. The engine never
  produces a synthetic receipt.

## 3. Status logic (`assessPo`)

| Evidence | Status |
|---|---|
| no valid tracking | blocked, `PO_GUARD_NO_TRACKING` |
| tracking, no events, no POD | `label_created` |
| tracking + events, no POD | `in_transit` |
| tracking + signed scan present | `delivered` (with `podRef`) |

Verify the shape any time: `node scripts/test-po-tracking-shape.mjs`
(exit 0 = the contract in this document still holds).
