# Manual Schema Creation Required

Automatic schema creation failed due to permission restrictions (403/404). 
You MUST manually create the following schemas in the Base44 Dashboard for the system to function correctly.

## 1. Earning
Required for tracking individual revenue allocations.

Fields:
- **earning_id** (Text, Unique, Required)
- **amount** (Number, Required)
- **currency** (Text, Required)
- **occurred_at** (Text, Required)
- **source** (Text, Required)
- **beneficiary** (Text, Required)
- **status** (Text, Required)
- **settlement_id** (Text)
- **metadata** (JSON)

## 2. PayoutBatch
Required for grouping payments into batches (PayPal, Bank Wire).

Fields:
- **batch_id** (Text, Unique, Required)
- **status** (Text, Required)
- **total_amount** (Number, Required)
- **currency** (Text, Required)
- **approved_at** (Text)
- **submitted_at** (Text)
- **cancelled_at** (Text)
- **paypal_payout_batch_id** (Text)
- **notes** (JSON)
- **settlement_id** (Text)
- **earning_ids** (JSON)
- **revenue_event_ids** (JSON)

## 3. PayoutItem
Required for individual line items within a payout batch.

Fields:
- **item_id** (Text, Unique, Required)
- **batch_id** (Text, Required)
- **status** (Text, Required)
- **amount** (Number, Required)
- **currency** (Text, Required)
- **processed_at** (Text)
- **revenue_event_id** (Text)
- **transaction_id** (Text)
- **recipient** (Text)
- **recipient_type** (Text)
- **earning_id** (Text)

## Instructions
1. Go to your Base44 App Dashboard.
2. Navigate to "Data" or "Entities".
3. Click "Create New Entity" (or "New Schema").
4. Enter the name exactly as above (e.g., `Earning`).
5. Add each field with the specified type.
6. Save.
7. Repeat for `PayoutBatch` and `PayoutItem`.

Once done, run `node src/emit-revenue-events.mjs` again to retry processing.
