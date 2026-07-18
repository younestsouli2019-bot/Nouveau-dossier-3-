# Webhook Error Resolution Plan

The webhook errors are likely due to the recent "migration" to the local store. The `paypal-webhook-server.mjs` script might still be trying to write events to the Base44 API, which is down/bypassed.

## 1. Diagnosis
*   I will read `src/paypal-webhook-server.mjs` to see how it handles incoming webhooks.
*   It likely uses `base44.asServiceRole.entities[...]` directly, which needs to be patched to support the new `SWARM_MODE=local`.

## 2. Remediation
*   **Patch Webhook Server:** I will modify `src/paypal-webhook-server.mjs` to import and use `LocalSwarmStore` when `SWARM_MODE=local`.
*   **Ingest Logic:** Incoming PayPal webhooks (e.g., `PAYMENT.CAPTURE.COMPLETED`) will be written to `data/local_swarm/PayPalWebhookEvent/` instead of failing against the Base44 API.

## 3. Verification
*   I will restart the webhook server in local mode and simulate a webhook payload to confirm it writes to the local JSON store without error.

**Immediate Step:** Read the webhook server code to identify the patch points.