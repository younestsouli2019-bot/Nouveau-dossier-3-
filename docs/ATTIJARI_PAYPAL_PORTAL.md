# Attijari-PayPal Portal & Compliance Guide

## Overview
To repatriate PayPal funds to Morocco in compliance with the **Office des Changes**, you must use the dedicated portal:
**URL**: `https://attijaripaypal.attijariwafa.com/PayPal`

**Note**: Access may be geo-restricted or require specific browser headers. If "Request Rejected" occurs, ensure you are using a clean browser session or a Moroccan IP if possible (though usually not strictly required for the login page itself).

## Regulatory Compliance (Office des Changes)
The Swarm enforces the following regulatory splits on all repatriated revenue:

*   **70% Retention (Compte en Devises)**:
    *   Funds are kept in EUR/USD.
    *   Used for: SaaS subscriptions, hosting (AWS/Vercel), international services.
    *   **Goal**: Hedge against currency fluctuation and maintain operational purchasing power.

*   **30% Conversion (Compte Dirhams)**:
    *   Funds are converted to MAD.
    *   Used for: Local taxes, salary (Entrepreneur), local expenses.

## Activation Process
1.  **Credentials**: Obtain Login + Password from your Attijariwafa agency.
2.  **SMS Code**: Sent to your registered mobile number upon login attempt.
3.  **Link Account**: Connect your PayPal account to the Attijari bank account via the portal.

## Automation & Tooling
The Swarm cannot directly control the browser due to security gates (WAF/2FA), but it **facilitates** the process using the "Clipboard Bridge".

### How to Login / Verify Revenue
1.  **Receive SMS** on your phone.
2.  **Copy** the SMS text.
3.  **Run the Swarm Tool**:
    ```bash
    node src/ops/verify-real-sms.mjs
    ```
4.  The tool will:
    *   Auto-detect the code or revenue amount from your clipboard.
    *   Calculate the 70/30 split automatically.
    *   Ingest the event into the "Truth Ledger".

## Troubleshooting
*   **"Request Rejected"**: Clear cookies, try Incognito mode, or check your IP reputation.
*   **No SMS**: Check with your agency if the phone number is updated.
