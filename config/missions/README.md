# Revenue missions

`revenue-missions.json` declares autonomous agent missions for Shopify + Base44.

- Secrets are referenced **by name only**. Set them yourself in
  Settings → Secrets and variables → Actions (never commit values):
  `OWNER_PAYPAL_EMAIL`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_API_KEY`,
  `BASE44_API_KEY`, `BASE44_APP_ID`.
- Create the Shopify app/token manually via accounts.shopify.com (Dev Dashboard / custom app).
- Payouts to OWNER accounts only go through `owner-payout.yml`, which requires
  human approval via the `payouts` environment.
