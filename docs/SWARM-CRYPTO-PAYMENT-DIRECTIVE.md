# SWARM CRYPTO PAYMENT DIRECTIVE

## CLASSIFICATION: OWNER AUTHORIZED

---

## MANDATORY POLICY: ALL PAYMENTS IN CRYPTO

### ZERO WASTE. L2 PREFERRED. NO EXCEPTIONS.

---

## 1. CUSTOMER PAYMENT REQUIREMENTS

**ALL customers MUST pay in crypto:**

| Priority | Asset | Network | Fee |
|----------|-------|---------|-----|
| **1st** | USDT | TRC20 (Tron) | ~1 USDT |
| **2nd** | USDT | Polygon | <0.01 USDT |
| **3rd** | USDT | Arbitrum | ~0.10 USDT |
| **4th** | BTC | Lightning | <0.01 USD |
| **5th** | ETH | Arbitrum | ~0.10 USD |
| **6th** | SOL | Native | <0.01 USD |

**NO FIAT ACCEPTED. NO WASTE.**

---

## 2. PAYMENT FLOW

```
Customer → Crypto (L2) → SWARM Treasury → Vendor
                    ↓
            Bank Wire → Owner Account
```

---

## 3. FUND RECOVERY - ZERO WASTE

**ALL funds recovered from:**

1. **Binance Dust** → Convert to BNB → Sell for USDT → Withdraw TRC20
2. **Bitget** → Migrate to V2 API → Consolidate → Withdraw TRC20
3. **Stuck Transactions** → Investigate → Recover → Consolidate
4. **Escrow Funds** → Complete or cancel trades → Release
5. **Locked Funds** → Withdraw from Earn/Locked → Consolidate

**NOTHING GETS LOST.**

---

## 4. BANK WIRE SETTLEMENT

**Flow:**
1. Convert all crypto to USDT on exchange
2. Sell USDT via P2P for MAD (~9.66 MAD/USDT)
3. Buyer sends MAD to Attijariwafa Bank
4. Verify receipt in owner account

**Bank Details:**
- Bank: Attijariwafa Bank
- Account: M TSOULI YOUNES
- RIB: 007 810 0004485000305941 82
- SWIFT: BCMAMAMC
- Branch: RABAT AGDAL

---

## 5. L2 PAYMENT BENEFITS

| Network | Speed | Fee | Best For |
|---------|-------|-----|----------|
| Lightning | <1 sec | <0.01 | Micro-payments |
| TRC20 | ~3 sec | ~1 USDT | All amounts |
| Polygon | ~2 sec | <0.01 | Small-medium |
| Arbitrum | ~10 sec | ~0.10 | Large amounts |
| Base | ~10 sec | ~0.05 | Medium-large |
| Solana | <1 sec | <0.01 | Fast settlements |

---

## 6. EXECUTION COMMANDS

```bash
# Check treasury status
node swarm-crypto-treasury.js

# Execute fund recovery
node swarm-fund-recovery.js

# Process customer payment
node swarm-l2-payment-processor.js

# Bank wire setup
node swarm-bank-wire.js
```

---

## 7. ESCROW RECOVERY

**Types of escrow to recover:**
- P2P trades pending completion
- Exchange locked/staking funds
- Failed withdrawal returns
- Unclaimed launchpad tokens

**All recovered funds → USDT → Bank Wire → Owner Account**

---

## 8. MONITORING

- Real-time balance tracking across all exchanges
- Automatic dust detection
- Failed transaction alerts
- Escrow status monitoring

---

**POLICY: ZERO WASTE. ALL FUNDS RECOVERED. L2 PAYMENTS ONLY.**

**"NOTHING GETS LOST. WE CANNOT AFFORD WASTE."**
