# Order-Placement Worklist — Moroccan/Local (2026-09-01)

**Goal:** move the 175 ProcurementItems off `sourced/ordered/purchased` (0 delivered) by placing
**real orders** with curated Moroccan suppliers and entering **real orderRef + carrier tracking**
so the (now-relaxed) gates let items advance to `delivered/received`.

**Rule that no longer blocks this:** the phantom-quarantine sweep was relaxed on 2026-09-01
(commit `727e6a4e9a`). Delivered/received now only need a real orderRef, a real supplier+order
pair, or a deliveredAt — an invented `pod:` SHA hash and `events>50chars` gate are **gone**.
Financial fail-closed gates (payouts, settlements, revenue) are **untouched**.

**The blocker now is purely physical:** no orders placed / no real tracking entered. Fix that
and the pipeline advances.

## Reading this doc
- **PLACE ORDER** = sourced item with a lead available; call/WhatsApp the supplier, pay, get orderRef.
- **CHASE SHIPMENT** = already `ordered` (has an orderRef like YT-001/HT-00x/BT-00x); get carrier + tracking.
- **ENTER REAL SUPPLIER + orderRef** = item claims `purchased` but has no supplier/ref; backfill real data.

---

## Priority suppliers (~248 units of the wholesale block) — the single biggest lever
| Supplier | Contact | What | For |
|---|---|---|---|
| **Alfa Gros** | 0630000011 (tm alfagros) | Electronics wholesale, direct importer, Casablanca kaysariya | The 50-item / ~225-unit "Électronique wholesale" block + wholesale lots + most electronics |
| **JemlaMaroc** | (via Alfa Gros / own channel) | Moroccan wholesale | Backup for the same block |
| **moroccosupport.com / investmorocco.ai** | — | B2B sourcing-agent | **Escalation only** if no direct channel; don't block on it |

## Fast-moving category suppliers
| Category | Supplier | Contact | Notes |
|---|---|---|---|
| Electronics / refurb PCs | **KRTechPro** | 0604118058 (Casa) | Dell Precision refurb best fit (2×$1798 + storage) |
| Electronics / TV+audio | **Planet Electro / Alfa Gros** | 0684390026 / 0630000011 | Samsung TV/Soundbar |
| Cameras/security | **Orgostech / Alfa Gros** | — | DVR/cam packs |
| Clothing/shoes | **simo_shoop_** | 0784499160 (Casa derb sultan) | t-shirts/polos/trousers/shoes bulk (24 units) |
| Perfume | **Parfumerie Prestige** | 0782-920468 | Parfumerie.ma; One Million / Mont Blanc |
| Health/supplements | **Superfood.ma** | (skill-approved) | NAC/Nitric/Diabetes packs — attach real order+tracking |
| Oral care | **Opalescence / Amed.ma** | — | Whitening |
| Food (produce) | **Marche local Bouznika** | — | Legumes + poisson |
| Food (coffee/honey) | **Mirka.ma / Beta Miel** | (skill-approved) | Café Arabica Bali |
| Home/deco | **Déco Shop** | 0651296438 (Fès) | deco, rangement, papier peint, stickers |
| Kitchen | **Tout à Tous / Jumia** | — | évier protectors, brosse, pause café |
| Auto | **Coding Auto** | 0602942029 (Agadir) | dashcam / car accessories |
| Moto | **MB Moto** | 077974811 | moto/auto parts |

## What to do NOW (order of impact)
1. **Wholesale electronics block** (225 units, ~$1,349): contact **Alfa Gros** (0630000011) — this is the
   biggest single cluster and maps to real Moroccan wholesale, not dropping 220 units on a sourcing agent.
2. **Dell Precision refurbs** ($2,097): **KRTechPro** refurb (Avito-mirror) already exists as supplier —
   place order + tracking.
3. **fashion block** (24 units): **simo_shoop_** bulk (Casa derb sultan).
4. **health block** (12 units): **Superfood.ma** — the items are `ordered` with refs (BT-001/002/003);
   chase carrier + tracking, they're likely delivered in person.
5. Everything else: consult `data/out/order-placement-worklist.csv` (168 rows) per-item.

## After an order is placed
Enter: `orderRef` (real supplier order id) + `carrier` + `trackingNumber` + `deliveredAt`.
Then the sweep/ORM keeps the item at `delivered/received` — **no fabricated hash needed anymore.**
