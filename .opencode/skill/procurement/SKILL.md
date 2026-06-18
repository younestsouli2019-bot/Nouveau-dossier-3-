---
name: procurement
description: Use when managing procurement requests, ordering items for recipients, tracking deliveries, or processing owner_bank_requests.csv. Trigger on keywords: procurement, order, deliver, Bachir, Younes, Hind, superfood, samsung.
---

# Procurement Operations Skill

## Purpose
Manage the end-to-end procurement workflow for the Khwarizmian Swarm, from request intake through delivery confirmation.

## Data Files
- `data/procurement-requests.json` - All active procurement requests
- `archive/owner_bank_requests.csv` - Bank transfer requests (10 items, $18,431.50 total)

## Active Recipients

### Mr. Bachir Tsouli (CRITICAL - Deadline June 20, 2026)
- Address: Rabat Agdal
- Items: Superfood.ma Nitric Oxide Pack + Diabetes Pack
- Payment: Pre-paid by SWARM

### Mr. Younes Tsouli
- Address: Bouznika
- Items: 22 items (Samsung TV, Soundbar, Dashcam, cleaning equipment)
- Payment: Pre-paid by SWARM

### Mrs. Hind Tsouli
- Address: Sidi-Yahya-Zaïr, CIN A336103, Tel 0602680629
- Items: 5 items (Samsung TV, Soundbar, Dashcam, cleaning items)
- Payment: Pre-paid by SWARM

## Workflow Steps
1. Read procurement-requests.json
2. Check payment status (all pre-paid)
3. For each recipient:
   a. Verify item availability
   b. Place order with vendor
   c. Get order confirmation
   d. Update Mission entity in Base44
   e. Track shipment
   f. Confirm delivery
4. Report completion to owner

## Payment Routes
- Bank wire for large orders (>$500)
- Payoneer for medium orders ($100-$500)
- Crypto for international transfers
- PayPal for small orders (<$100)

## Safety Rules
- All items pre-paid by SWARM
- Recipients do not disburse anything
- Verify recipient details before ordering
- Track all transactions in exports/reports/
