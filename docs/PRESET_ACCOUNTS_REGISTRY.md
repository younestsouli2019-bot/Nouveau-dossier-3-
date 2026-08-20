# Pre-Set Owner Accounts — Full Registry

Sourced from repo settlement instructions (PayPal/Payoneer) and owner-submitted RIBs (Attijariwafa Bank).
All accounts belong to M TSOULI YOUNES. No third-party or externally-owned destinations.

## Rails & Accounts

| Account ID | Rail | Currency | Holder | Bank/Provider | Max/tx | Daily Limit | Fee |
|-----------|------|----------|--------|---------------|--------|-------------|-----|
| preset_wise_001 | Wise | EUR | Younes Tsouli | Wise | $25,000 | $100,000 | 0.5% |
| preset_stripe_001 | Stripe | USD | Younes Tsouli | Stripe Connect | $25,000 | $100,000 | 0.8% |
| preset_bankwire_attijari_001 | Bank Wire | MAD | M TSOULI YOUNES | Attijariwafa Bank (Rabat Agdal) | $50,000 | $200,000 | 0.3% |
| preset_bankwire_attijari_002 | Bank Wire | MAD | M TSOULI YOUNES | Attijariwafa Bank (Rabat Agdal) | $50,000 | $200,000 | 0.3% |
| preset_paypal_001 | PayPal | USD | Younes Tsouli | PayPal | $10,000 | $50,000 | 2% |
| preset_payoneer_001 | Payoneer | USD | Younes Tsouli | Payoneer | $5,000 | $20,000 | 2% |

## Attijariwafa Bank Accounts (RIB → IBAN)

Both accounts registered at branch **RABAT AGDAL FAL OULD OUMEIR**, SWIFT/BIC `BCMAMAMC`.

**Compte 1**
- RIB: `007 810 0004485000305941 82`
- IBAN: `MA64 0078 1000 0448 5000 3059 4182`

**Compte 2**
- RIB: `007 810 0004482000613213 72`
- IBAN: `MA64 0078 1000 0448 2000 6132 1372`

IBAN check digits computed via ISO 7064 mod-97-10 algorithm from the RIB (bank code + city code + account number + RIB key).

## Routing Logic

In MA jurisdiction (default for this swarm), the pipeline prefers **bank_wire** for local MAD settlement — cheapest fees (0.3%), no FX loss, and round-robins between the two Attijariwafa accounts to spread balances evenly.

For non-MA jurisdictions or when bank_wire limits are exceeded, it falls back in priority order: Wise → Stripe → PayPal → Payoneer.

## Security Note

RIBs/IBANs are bank account **identifiers**, not credentials — they cannot be used to withdraw funds, only to receive them. Safe to store in the pipeline config. No PIN, password, or API secret is stored alongside them.

---

*Updated: 2026-08-20 · Source: owner-submitted RIB PDFs + existing repo settlement instructions*