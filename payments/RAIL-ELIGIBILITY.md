# Payment rail eligibility — entity jurisdiction first

**Last verified: 4 November 2026.** Confidence is labelled because provider
lists change; confirm on the provider's own page before applying. Do not treat
this table as an approval.

## Why this document exists

A clearing account is gated by **where the legal entity is registered**, not
where the founder lives. Most tier-1 B2B providers (Airwallex, Wise Business,
3S Money) onboard companies registered in their licensed markets. A Moroccan
entity applying directly is usually declined at the jurisdiction filter before
any document is read.

## Matrix

| Provider | What it is | Entity jurisdiction requirement | MA entity direct? | Confidence |
|---|---|---|---|---|
| **Attijariwafa** | Domestic bank + wire rail (already in the stack) | Morocco | **Yes** | High — existing account |
| **CMI / SimplePay** | Moroccan card processor (MAD) | Morocco | **Yes** (requires merchant contract) | High |
| **Airwallex** | B2B multi-currency accounts, local collection, FX, payouts | Business registered in US, UK, AU, CA, HK, NZ, SG, most of Europe | **No** | High — official Airwallex guidance lists those markets |
| **Wise Business** | Multi-currency account, local IBANs, FX | Business registered in a supported country (MA not on the business list) | **No** (confirm on Wise's country list) | High, verify at signup |
| **3S Money** | High-touch B2B clearing for complex structures | Typically UK / EU / HK / SG entity | **No** without a foreign entity | Medium — confirm with their team |
| **Payoneer** | Receiving accounts + payout rails | Varies; company accounts for MA frequently declined | **Unreliable** | Medium — community reports; individual accounts differ from company accounts |
| **Stripe** | Card acquiring | Business registered in a Stripe-supported country | **No** | High — MA not supported; confirm at stripe.com/global |
| **Paddle** | Merchant of Record (handles tax, sells on your behalf) | Seller must be in a Paddle-supported country | **Unverified** — confirm in signup | Medium |
| **Lemon Squeezy** | Merchant of Record | Seller must be in a supported country | **Unverified** — confirm in signup | Medium |

## The three viable architectures

1. **Merchant of Record for collections (no clearing account needed).**
   Paddle / Lemon Squeezy act as the seller of record, collect from the buyer,
   handle VAT/sales tax, and pay out to you. Best fit for digital certification
   products sold worldwide. Verify seller-country support before committing.

2. **Foreign entity + tier-1 clearing.**
   Incorporate (e.g.) a UK LTD, then apply to Airwallex / Wise Business /
   3S Money with that entity. Gives real local IBANs, ACH/SEPA, and Stripe
   eligibility. Cost: formation, filings, UBO documentation, tax registrations,
   and a real operating presence expectation.

3. **Moroccan stack for Moroccan flows.**
   Attijariwafa for wires, CMI/SimplePay for MAD cards. Works domestically;
   cross-border card collection stays limited.

## Flow-of-funds statement (what underwriters ask for)

Describe the actual path, in one paragraph and one diagram:

```
Customer (global) ──► [MoR / processor] ──► [entity account] ──► [owner payout rail]
   card / wallet        collects + taxes      multi-currency        Attijariwafa first
```

For each rail, state: who holds funds, for how long, what the payout cadence
is, and which entity receives them. Underwriters reject vague diagrams faster
than they reject complex ones.

## Compliance note — describe the business truthfully

The storefront's dominant activity is accurate to describe as an **online
education marketplace selling practice-exam subscriptions and study material
for professional certifications** (digital delivery, no goods). That is the
right descriptor.

Do **not** omit a real payment rail to make the profile look simpler. If the
same legal entity also receives crypto or runs automated payouts, disclose it
and describe the controls. Banks terminate accounts for misrepresentation far
more often than for complexity — and a terminated account is harder to replace
than a slow onboarding.

## Environment variables the checkout uses

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Card checkout via Stripe (only where the entity is eligible) |
| `CHECKOUT_LINK_MAP_PADDLE` | JSON map `{ "course-slug": "https://pay.paddle.io/..." }` |
| `CHECKOUT_LINK_MAP_LEMONSQUEEZY` | JSON map `{ "course-slug": "https://<store>.lemonsqueezy.com/..." }` |
| `CHECKOUT_RAIL_ORDER` | Optional order, default `paddle,lemonsqueezy` |
| `BUSINESS_JURISDICTION` | Shown by `/api/checkout/rails` (e.g. `MA`) |

Only allowlisted hosts (`*.paddle.com`, `*.paddle.io`, `*.lemonsqueezy.com`)
are accepted; everything else is rejected at resolve time. `/api/checkout/rails`
reports readiness as booleans and product counts — never keys or URLs.
