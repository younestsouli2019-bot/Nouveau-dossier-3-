# Enterprise Bank Setup (Attijariwafa / IBAN Mode)

Since the Bank API requires an LLC and history, we are using **IBAN Mode**.
The Swarm will generate wire instructions and track requests, but you must verify the arrival of funds in your AttijariNet app.

## 1. Configure `.env`
Open your `.env` file and set the mode to `IBAN`.

```ini
# ENTERPRISE BANK CONFIGURATION (IBAN MODE)
ENTERPRISE_BANK_MODE="IBAN"
ENTERPRISE_BANK_IBAN="<YOUR_ATTIJARI_IBAN>"
ENTERPRISE_BANK_RIB="<YOUR_RIB>"
ENTERPRISE_BANK_SWIFT="<YOUR_SWIFT_CODE>"
ENTERPRISE_BANK_NAME="Attijariwafa Bank"
```

## 2. How it Works
1.  **Revenue Accumulates**: PayPal/Stripe collects funds.
2.  **Swarm Triggers**: When balance > Threshold (e.g., $500), the Swarm calls `generateWireRequest`.
3.  **You Receive**: A text file/email with the exact wire details to paste into PayPal/Payoneer.
4.  **You Confirm**: When money hits Attijari, you tell the Swarm (or it assumes success after 3 days).

## 3. Future Upgrade (API)
Once you have the LLC and cashflow history, simply change `ENTERPRISE_BANK_MODE="API"` and add the Client ID/Secret. The code is already waiting.
