# Price book

This file is the **only** permitted source of a course price for
`POST /api/orders`. A price is never read from the request body, the
catalog, a query string, or anything the buyer controls.

## Why a separate file

The published catalog (`../catalog.json`) carries `title`, `category`,
`description`, counts, `language`, `image`, `slug`. It deliberately has
**no price field**, and neither does the live site's copy of that catalog —
verified against `https://www.realworldcerts.com/data/catalog.json` on
2026-09-30. Prices are commercial decisions and change on their own
schedule; course metadata changes on a different one. Mixing them means
every price edit is a full catalog republish.

It also means the currently-live sales model is **quote-on-request**: the
checkout page renders "Course price — Confirmed via email" and instructs
the buyer to send a PayPal payment for an amount they are told separately.
That is a manual loop, and it is why there are zero captured orders.

## Modes

Each entry under `courses` is keyed by catalog `slug` and carries one mode.

| `mode` | Meaning | Order outcome |
| --- | --- | --- |
| `fixed` | `amountMinor` is authoritative. | Order created, `awaiting_payment`, amount returned to the buyer to pay exactly. |
| `quote_required` | No published price. The course is sellable but priced per deal. | Order created, `awaiting_quote`, **no amount returned**. A human quotes and confirms out of band. |
| absent from `courses` | Not for sale, or not yet reviewed. | `404 course_not_found`. No order, no reference. |

`quote_required` is the honest encoding of how the business currently
works. It lets a lead be captured without inventing a number, which is the
difference between a real funnel and a fabricated one.

## Amounts

`amountMinor` is an **integer in minor units** (MAD cents), never a float
and never a formatted string. `"1250"` means 12.50 MAD. Floats are avoided
because `0.1 + 0.2` style drift in a payment amount is a reconciliation
bug that surfaces weeks later as an unmatched order.

`minorUnits` is declared once at the top level. If it ever changes, every
existing `amountMinor` changes meaning with it, so treat a change to that
field as a migration, not a config tweak.

## Shape

```json
{
  "schemaVersion": 1,
  "updated": "2026-09-30",
  "currency": "MAD",
  "minorUnits": 2,
  "courses": {
    "isaca-cism-practice-exams": {
      "mode": "fixed",
      "amountMinor": 1250,
      "approvedBy": "owner",
      "approvedAt": "2026-09-30",
      "note": "launch price"
    },
    "some-new-course": {
      "mode": "quote_required",
      "approvedBy": "owner",
      "approvedAt": "2026-09-30"
    }
  }
}
```

`approvedBy` / `approvedAt` are not decoration. A price is a commercial
commitment, so the file records who authorised it and when. An entry with
no approval metadata is rejected rather than guessed at.

## Publishing rules

1. Prices come from the owner. This codebase will not generate them.
2. One price book per currency. Mixed currencies need a separate file.
3. `absent` is a valid, safe state. A course with no entry simply is not
   purchasable yet.
4. Adding an entry is a code change and goes through review like any other.
   Do not have a build step invent entries.

## Fail-closed behaviour

If the book is missing, unreadable, wrong `schemaVersion`, or the slug is
unknown, `POST /api/orders` returns `503 price_book_unavailable` or
`404 course_not_found` and **mints no reference**. No order exists that an
operator could later be asked to reconcile against a number the system
does not actually have.

An order in `awaiting_quote` has no amount, so it can never be matched
against a payment by mistake. It is a lead, not a receivable.
