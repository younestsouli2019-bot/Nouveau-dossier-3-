# SWARM SECURITY POLICY
**Owner: Younes Tsouli (younestsouli2019@gmail.com)**
**Effective: 2026-06-18**
**Purpose: Prevent identity theft, misappropriation of funds, undue procurement, and unauthorized use**

---

## 1. OWNER-ONLY ACCESS CONTROL

### 1.1 Identity Verification
- **Owner identity**: Younes Tsouli, CIN Moroccan, DOB: [REDACTED]
- **Owner email**: younestsouli2019@gmail.com (PRIMARY, only authorized)
- **Owner GitHub**: CoNrAd2525 (ONLY authorized GitHub account)
- **Owner phone**: +212639158209 (ONLY authorized phone)
- **Owner PayPal**: younestsouli2019@gmail.com
- **Owner Payoneer**: younestsouli2019@gmail.com
- **Owner IBAN**: LU774080000041265646 (BIC: BCIRLULL)
- **Owner crypto**: 0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7 (Trust Wallet)

### 1.2 Access Rules
```
RULE 1: ONLY the owner (younestsouli2019@gmail.com) can:
  - Approve financial transactions > 0 MAD
  - Modify SWARM configuration
  - Access secrets and API keys
  - Modify procurement orders
  - Change recipient details
  - Approve bank wire transfers
  - Access crypto wallets

RULE 2: ALL other users are DENIED by default
  - No shared accounts
  - No proxy access
  - No delegated financial authority

RULE 3: Owner verification required for:
  - Every financial transaction
  - Every procurement order > 100 MAD
  - Every configuration change
  - Every secret rotation
```

### 1.3 Multi-Factor Authentication
- GitHub: 2FA required on CoNrAd2525 account
- Email: 2FA required on younestsouli2019@gmail.com
- PayPal: 2FA required
- Payoneer: 2FA required
- Base44: Service token only (no password sharing)

---

## 2. ANTI-FRAUD MECHANISMS

### 2.1 Transaction Limits
```
MAX_SINGLE_TRANSACTION: 50,000 MAD
MAX_DAILY_TRANSACTIONS: 100,000 MAD
MAX_MONTHLY_TRANSACTIONS: 500,000 MAD
MIN_TRANSACTION_AGE: 10 minutes (anti-rush)
MAX_RECIPIENTS_PER_DAY: 10
```

### 2.2 Allowlisted Recipients
```
RECIPIENT_ALLOWLIST:
  - Younes Tsouli (Bouznika) — self
  - Bachir Tsouli (Rabat) — family
  - Hind Tsouli (Sidi-Yahya-Zaïr) — family
  - Yacine Tsouli (Rabat) — family
  - Top_Adam (Rabat) — authorized contact
  - Wafae Rais (Rabat) — authorized contact
```

### 2.3 Blocked Recipients
```
BLOCKED:
  - Any recipient NOT in allowlist
  - Any recipient with suspicious address changes
  - Any new recipient not approved by owner
  - Any recipient outside Morocco (unless owner-approved)
```

### 2.4 Procurement Safeguards
```
RULE: Every procurement order requires:
  1. Owner approval (email confirmation or manual approval)
  2. item verification (source, price, recipient match)
  3. Budget check (within approved limits)
  4. Duplicate detection (no double-orders)
  5. Delivery confirmation (proof of delivery required)
```

---

## 3. ANTI-IDENTITY THEFT

### 3.1 Data Protection
```
ENCRYPTED_DATA:
  - All API keys and secrets (GitHub Actions secrets)
  - All financial credentials (PayPal, Payoneer, bank)
  - All personal information (CIN, addresses, phones)
  - All procurement data (addresses, orders)

ACCESS_LOG:
  - Every access to sensitive data is logged
  - Every modification to financial config is logged
  - Every new recipient addition is logged
  - Logs retained for 90 days
```

### 3.2 Session Security
```
SESSION_TIMEOUT: 30 minutes
MAX_LOGIN_ATTEMPTS: 5
LOCKOUT_DURATION: 30 minutes
IP_WHITELIST: Owner's known IPs only
```

### 3.3 Secret Management
```
SECRETS_ROTATION: Every 90 days
SECRETS_AUDIT: Monthly
SECRETS_ACCESS: Owner only
SECRETS_BACKUP: Encrypted, owner-controlled
```

---

## 4. ANTI-MISAPPROPRIATION OF FUNDS

### 4.1 Financial Controls
```
DUAL_APPROVAL: Required for transactions > 10,000 MAD
BUDGET_ALERTS: Owner notified for any transaction > 5,000 MAD
DAILY_SUMMARY: Owner receives daily financial summary
WEEKLY_AUDIT: Automated audit of all financial transactions
```

### 4.2 Bank Wire Security
```
BANK_WIRE_RULES:
  1. Owner beneficiary name MUST match: Younes Tsouli
  2. IBAN MUST match: LU774080000041265646
  3. BIC MUST match: BCIRLULL
  4. No wire transfers to NEW accounts without owner approval
  5. No wire transfers > 50,000 MAD without dual approval
  6. All wire transfers logged and reported to owner
```

### 4.3 Crypto Security
```
CRYPTO_RULES:
  1. ONLY Trust Wallet address: 0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7
  2. No transfers to unknown addresses
  3. No transfers > 1 ETH equivalent without owner approval
  4. All crypto transactions logged and reported
  5. Hardware wallet recommended for large holdings
```

### 4.4 PayPal/Payoneer Security
```
PAYMENT_RULES:
  1. Only owner email linked: younestsouli2019@gmail.com
  2. No payment to non-allowlisted recipients
  3. All payments > 1,000 MAD require owner confirmation
  4. Daily transaction limit enforced
  5. Suspicious activity triggers owner alert
```

---

## 5. ANTI-UNDUE PROCUREMENT

### 5.1 Procurement Authorization
```
PROCUREMENT_RULES:
  1. ALL procurement must match approved recipient list
  2. ALL procurement must have verifiable source
  3. ALL procurement must be within approved budget
  4. ALL procurement must have delivery confirmation
  5. NO procurement without owner awareness
```

### 5.2 Vendor Verification
```
VENDOR_RULES:
  1. Only verified Moroccan e-commerce sites
  2. No unknown or suspicious vendors
  3. All vendor links must be valid and working
  4. All prices must be current and verified
  5. No overpriced items (must match market rates)
```

### 5.3 Delivery Verification
```
DELIVERY_RULES:
  1. Delivery address must match approved addresses
  2. Delivery confirmation required (photo/tracking)
  3. No delivery to unknown locations
  4. Recipient must confirm receipt
  5. Any delivery issues reported to owner immediately
```

---

## 6. WORKFLOW SECURITY

### 6.1 GitHub Actions Security
```
WORKFLOW_RULES:
  1. Only owner can trigger manual workflows
  2. All workflows run on ubuntu-latest (secure)
  3. All secrets encrypted in GitHub Actions
  4. No secrets in logs or artifacts
  5. Workflow permissions: contents:read only
  6. Concurrency: single run at a time (no parallel)
```

### 6.2 API Security
```
API_RULES:
  1. All API calls authenticated
  2. All API keys encrypted
  3. Rate limiting enforced
  4. All API responses validated
  5. No sensitive data in API responses
```

### 6.3 Database Security
```
DATABASE_RULES:
  1. Base44 data encrypted at rest
  2. Base44 data encrypted in transit
  3. Service token authentication only
  4. No direct database access
  5. All modifications logged
```

---

## 7. MONITORING & ALERTING

### 7.1 Real-Time Alerts
```
ALERT_TRIGGERS:
  - Any financial transaction > 5,000 MAD
  - Any new recipient added
  - Any configuration change
  - Any failed authentication attempt
  - Any suspicious activity
  - Any delivery failure
```

### 7.2 Daily Reports
```
DAILY_REPORTS:
  - Financial summary (all transactions)
  - Procurement summary (all orders)
  - Security summary (all access attempts)
  - Delivery summary (all deliveries)
  - Owner notified via email
```

### 7.3 Audit Trail
```
AUDIT_RULES:
  - Every action logged with timestamp
  - Every user action tracked
  - Every financial transaction recorded
  - Every configuration change recorded
  - Logs tamper-proof (append-only)
  - Logs retained for 90 days
```

---

## 8. INCIDENT RESPONSE

### 8.1 Breach Protocol
```
IF UNAUTHORIZED ACCESS DETECTED:
  1. IMMEDIATELY revoke all affected credentials
  2. IMMEDIATELY notify owner via email + phone
  3. IMMEDIATELY freeze all financial operations
  4. IMMEDIATELY audit all recent transactions
  5. IMMEDIATELY rotate all secrets
  6. File police report if funds misappropriated
```

### 8.2 Recovery Protocol
```
IF FUNDS MISAPPROPRIATED:
  1. Contact PayPal/Payoneer/bank immediately
  2. File fraud claim
  3. Contact law enforcement
  4. Audit all SWARM activity
  5. Restore from last known good state
  6. Implement additional security measures
```

---

## 9. COMPLIANCE

### 9.1 Legal Compliance
```
COMPLIANCE:
  - Moroccan data protection law
  - EU GDPR (for European data)
  - PayPal acceptable use policy
  - Payoneer terms of service
  - GitHub terms of service
```

### 9.2 Financial Compliance
```
FINANCIAL_COMPLIANCE:
  - Anti-money laundering (AML) rules
  - Know your customer (KYC) requirements
  - Tax reporting obligations
  - Record retention requirements
```

---

## 10. OWNER RESPONSIBILITIES

### 10.1 Owner Must:
```
1. Keep all credentials secure
2. Enable 2FA on all accounts
3. Review daily reports
4. Approve significant transactions
5. Report any suspicious activity
6. Rotate secrets every 90 days
7. Keep contact information current
8. Monitor SWARM activity regularly
```

### 10.2 Owner Must NOT:
```
1. Share credentials with anyone
2. Use public WiFi for financial operations
3. Ignore security alerts
4. Leave sessions unattended
5. Use weak passwords
6. Click on suspicious links
7. Share CIN or personal information unnecessarily
```

---

**POLICY OWNER: Younes Tsouli**
**LAST UPDATED: 2026-06-18**
**NEXT REVIEW: 2026-09-18**
**VERSION: 1.0**
