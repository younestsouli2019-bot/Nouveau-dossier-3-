---
name: procurement
description: Use when managing procurement requests, ordering items for recipients, tracking deliveries, or processing owner_bank_requests.csv. Trigger on keywords: procurement, order, deliver, Bachir, Younes, Hind, superfood, samsung.
---

# Procurement Operations Skill

## Purpose
Manage the end-to-end procurement workflow for the Khwarizmian Swarm, from request intake through delivery confirmation.

## Data Files
- `data/procurement-requests.json` — All active procurement requests
- `archive/owner_bank_requests.csv` — Bank transfer requests (10 items, $18,431.50 total)

## Active Recipients

### M Bachir Tsouli (CRITICAL - Deadline June 20, 2026)
- Address: 45 Avenue Ibn Sina, Agdal, Rabat
- Phone: 0777077940
- Items: Superfood.ma Nitric Oxide Pack, Diabetes Pack, Tablet, Perfumes, Cane, Slippers
- Payment: Pre-paid by SWARM

### Mr Younes Tsouli
- Address: Lot. Rita LOT C Im B, APT 17, BOUZNIKA, CASABLANCA SETTAT 13100
- Phone: +212639158209
- Items: Dell laptops, cigarettes/filters, TV 65", coffee machine, mini-bar, electronics, OnePlus, whitening products, trail shoes, jackets, stickers, accessories
- Payment: Pre-paid by SWARM

### Mrs Hind Tsouli
- Address: Etage 2 JASMIN II IMM H3 APPT 21, SIDI-YAHYA-ZAIR, 12150 Casablanca
- Phone: 0602680629, CIN: A336103
- Items: Samsung TV 43", soundbar, dashcam, brush, pressure washer
- Payment: Pre-paid by SWARM

## Mandatory Sourcing Rules (ALL FUTURE POs)

### 1. Source Locally in Morocco — ALWAYS
**NEVER use international/import pricing.** All items MUST be sourced from Moroccan suppliers to minimize costs.

**Approved Moroccan platforms:**
- `jumia.ma` — General retail, widest catalog
- `jemlamaroc.com` — Wholesale/grossiste, bulk pricing
- `avito.ma` — Refurbished/used electronics (80% savings)
- `toko.ma` — Electronics, appliances
- `iris.ma` — Smartphones, electronics
- `marjanemall.ma` — Health, beauty, oral care
- `parfummaroc.com` — Perfumes, fragrances
- `superfood.ma` — Supplements, health packs
- `lepiceriefineandco.ma` — Tobacco, cigarettes
- `brooklynsmokeshop.ma` — Tobacco, cigars
- `yournightshop.ma` — Tobacco
- `brico.ma` — Hardware, tools
- `mediazone.ma` — Dell, laptops (new — prefer Avito refurbished)
- `tagin3d.ma` — 3D printing tools
- `moroccosupport.com` — Sourcing agent service
- `marocfournisseurs.com` — Supplier directory
- `investmorocco.ai/suppliers` — Verified suppliers directory

**Pricing rules:**
- Use refurbished electronics from Avito when available (saves 60-80%)
- Wholesale from JemlaMaroc for bulk items (cables, accessories, small electronics)
- Compare at least 2 Moroccan sources before pricing an item
- Never exceed $500/item unless absolutely necessary (e.g., Dell Precision laptop)
- Target total PO under $3,000 per request cycle

### 2. Pre-Paid by SWARM — ALWAYS
All items are pre-paid by the Swarm. Recipients never pay anything.

### 3. Recipients Do Not Disburse — ALWAYS
Recipients receive items free of charge. No COD, no reimbursements, no "repay later."

### 4. Item ID Format
Use format: `{RECIPIENT_INITIALS}-{SEQ}` (e.g., YT-001, HT-005, BT-003)

### 5. Required Fields per Item
- `id` — Unique item ID
- `item` — Product name with specs
- `qty` — Quantity
- `price_mad` — Unit price in MAD
- `total_mad` — qty × price_mad
- `source` — URL of Moroccan supplier
- `vendor` — Vendor/platform name
- `notes` — Must include "Pre-paid by SWARM"

## Workflow Steps
1. Read procurement-requests.json
2. For each new item, search Moroccan platforms for cheapest local price
3. Compare at least 2 sources per item
4. Add item to procurement-requests.json with local price
5. Mark all items: `prePaidBySwarm=true`
6. Verify recipients disburse nothing
7. Calculate total PO value — confirm under budget
8. For each recipient:
   a. Verify item availability
   b. Place order with vendor
   c. Get order confirmation
   d. Update Mission entity in Base44
   e. Track shipment
   f. Confirm delivery
9. Report completion to owner

## Payment Routes
- Bank wire for large orders (>$500)
- Payoneer for medium orders ($100-$500)
- Crypto for international transfers
- PayPal for small orders (<$100)

## Safety Rules
- **ALL items pre-paid by SWARM** — no exceptions
- **Recipients do not disburse anything** — no COD, no reimbursements
- **Source locally in Morocco** — never international/import pricing
- **Use refurbished electronics** when available — saves 60-80%
- **Wholesale for bulk items** — JemlaMaroc for cables, accessories, small electronics
- Verify recipient details before ordering
- Track all transactions in exports/reports/
- Target total PO under $3,000 per request cycle
