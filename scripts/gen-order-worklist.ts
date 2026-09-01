// Generates an actionable order-placement worklist mapping the 175 stalled
// ProcurementItems to curated Moroccan/local supplier leads (data/local-suppliers-2026-09-01.csv).
// Output: data/out/order-placement-worklist.csv (actionable) + console summary.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { db } from '../src/lib/db';

// Curated supplier leads, keyed by category keyword. From local-suppliers-2026-09-01.csv.
const LEADS = [
  // category keys (lowercase, matched against item.category+name), supplier, contact, channel/note
  { cat: 'electronics', name: 'Alfa Gros', contact: '0630000011 (tm alfagros)', note: 'electronics wholesale, direct importer, Casablanca kaysariya' },
  { cat: 'electronics', name: 'KRTechPro', contact: '0604118058 (Casa)', note: 'used/refurb PCs & workstations; mirrors Avito — good for Dell Precision refurb' },
  { cat: 'electronics', name: 'Orgostech', contact: '', note: 'cameras, PCs, TV box' },
  { cat: 'electronics', name: 'PCYAT', contact: '0655555582', note: 'laptops/PCs + accessories' },
  { cat: 'electronics', name: 'Planet Electro', contact: '0684390026', note: 'electronics wholesale + resale, Kénitra' },
  { cat: 'electronics', name: 'MobileLand', contact: '', note: 'LCD/OLED screens wholesale & retail' },
  { cat: 'electronics', name: 'MONTA Phone (MOUNIR)', contact: '0666155803', note: 'phone bulk/wholesale' },
  { cat: 'electronics', name: 'Kamal Phone', contact: '0681793843 (Salé)', note: 'phones repair+resale' },
  { cat: 'electronics', name: 'Huo/3C factory', contact: '+8613802916563 (WA)', note: 'China 3C parts factory; phone parts wholesale (import)' },
  { cat: 'perfume', name: 'Parfumerie Prestige', contact: '0782-920468', note: 'Parfumerie.ma official; One Million / Mont Blanc' },
  { cat: 'perfume', name: 'Milan Scent', contact: 'milanscent@gmail.com', note: 'fragrances strong brand' },
  { cat: 'perfume', name: 'Parfumerie Ghali', contact: '', note: 'authentic perfumes, décants, deliv MA' },
  { cat: 'perfume', name: 'Lazrak Fragrances', contact: '', note: 'Fès official distributor (exception perfumes)' },
  { cat: 'home', name: 'Déco Shop', contact: '0651296438 (Fès)', note: 'crystal decoration + household items — covers home gap' },
  { cat: 'home', name: 'Tout à Tous', contact: '', note: 'home decor + kitchen essentials' },
  { cat: 'home', name: 'stockageproo', contact: '', note: 'shelving, office/school furniture' },
  { cat: 'fashion', name: 'simo_shoop_', contact: '0784499160 (Casa derb sultan)', note: 'clothing bulk: t-shirts, polos, trousers, shorts' },
  { cat: 'fashion', name: 'Monte Carlo', contact: '0600099914 (Oujda)', note: "men's clothing, deliv MA" },
  { cat: 'fashion', name: '3abidine_dgdage', contact: '', note: "men's clothing wholesale, Sidi Moumen" },
  { cat: 'fashion', name: 'haroun.lamri', contact: '', note: "men's clothing bulk" },
  { cat: 'health', name: 'Superfood.ma', contact: '', note: 'already in skill approved list — packs stuck; attach real order+tracking' },
  { cat: 'health', name: 'Opalescence / Amed.ma', contact: '', note: 'oral-care whitening' },
  { cat: 'food', name: 'Marche local Bouznika', contact: '', note: 'local fresh produce (legumes + poisson)' },
  { cat: 'food', name: 'Mirka.ma', contact: '', note: 'skill approved ethanol/coffee — Café Arabica Bali' },
  { cat: 'food', name: 'Beta Miel', contact: '', note: 'honey / edible coffee packs' },
  { cat: 'furniture', name: 'ELEXIA (mini-bar)', contact: '', note: 'Mini-Bar ELEXIA RM004 — sourced direct' },
  { cat: 'auto', name: 'Coding Auto', contact: '0602942029 (Agadir)', note: 'car accessories / dashcam' },
  { cat: 'auto', name: 'MB Moto', contact: '077974811', note: 'moto/auto parts + accessories' },
  { cat: 'wholesale', name: 'moroccosupport.com / investmorocco.ai', contact: '', note: 'preferred B2B sourcing-agent channel for the 50-item Électronique wholesale block' },
  { cat: 'tobacco', name: 'lepiceriefineandco.ma (skill)', contact: '', note: 'use skill platform' },
  { cat: 'tobacco', name: 'Brooklyn Smoke Shop (skill)', contact: '', note: 'use skill platform' },
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const REFINED = [
  { words: ['dell', 'precision', 'laptop', 'workstation', 'refurb'], lead: { name: 'KRTechPro', contact: '0604118058', note: 'refurb PCs/workstations best for Dell Precision' } },
  { words: ['tv', 'led tv', 'soundbar', 'samsung smart', 'uhd'], lead: { name: 'Planet Electro / Alfa Gros', contact: '0684390026 / 0630000011', note: 'electronics wholesale, direct importer' } },
  { words: ['phone', 'smartphone', 'oneplus', 'tablette', 'tablet'], lead: { name: 'Alfa Gros', contact: '0630000011', note: 'electronics wholesale, direct importer' } },
  { words: ['camera', 'caméra', 'security camera', 'dvr', 'dashcam', 'surveillance'], lead: { name: 'Orgostech / Alfa Gros', contact: '', note: 'cameras, PCs; or Alfa Gros wholesale' } },
  { words: ['dashcam', 'bluetooth car', 'car phone', 'headlight', 'taillight', 'car led'], lead: { name: 'Coding Auto', contact: '0602942029 (Agadir)', note: 'car accessories / dashcam' } },
  { words: ['superfood', 'nac', 'nitric', 'diabetes'], lead: { name: 'Superfood.ma', contact: '', note: 'already in skill approved list — attach real order+tracking' } },
  { words: ['opalescence', 'whitening', 'whitestrips'], lead: { name: 'Opalescence / Amed.ma', contact: '', note: 'oral-care whitening' } },
  { words: ['one million', 'mont blanc', 'paco', 'parfum', 'perfume', 'fragrance'], lead: { name: 'Parfumerie Prestige', contact: '0782-920468', note: 'Parfumerie.ma official' } },
  { words: ['légume', 'legume', 'poisson', 'fish', 'fruits', 'produce', 'bouznika'], lead: { name: 'Marche local Bouznika', contact: '', note: 'local fresh produce' } },
  { words: ['café', 'coffee', 'cafe', 'arabica', 'bali', 'miel', 'honey'], lead: { name: 'Mirka.ma / Beta Miel', contact: '', note: 'skill approved coffee/honey' } },
  { words: ['mini-bar', 'minibar', 'elexia', 'rm004'], lead: { name: 'ELEXIA (mini-bar)', contact: '', note: 'Mini-Bar ELEXIA RM004 direct' } },
  { words: ['shirt', 't-shirt', 'tshirt', 'polo', 'trouser', 'short', 'jacket', 'vetement', 'clothing', 'slipper', 'shoe', 'chaussure'], lead: { name: 'simo_shoop_', contact: '0784499160 (Casa derb sultan)', note: 'clothing/trousers/shoes bulk' } },
  { words: ['autocollant', 'stickers', 'sticker'], lead: { name: 'Déco Shop / Jumia', contact: '0651296438 (Fès)', note: 'household/deco + stickers' } },
  { words: ['rangement', 'boîte', 'boite', 'murale', 'papier peint', 'cendrier', 'deco', 'decoration'], lead: { name: 'Déco Shop', contact: '0651296438 (Fès)', note: 'crystal decoration + household' } },
  { words: ['évier', 'evier', 'cuisine', 'kitchen', 'pause cafe', 'café gold'], lead: { name: 'Tout à Tous / Jumia', contact: '', note: 'home decor + kitchen essentials' } },
];

function matchLead(cat, name) {
  const c = normalize(cat);
  const n = normalize(name);
  for (const R of REFINED) {
    const hit = R.words.some(w => n.includes(w));
    if (hit) return R.lead;
  }
  // Category-based fallback (safe, exact token equality against lead categories)
  const catMap = {
    'wholesale': { name: 'Alfa Gros / JemlaMaroc', contact: '0630000011', note: 'direct Moroccan electronics wholesale — use sourcing-agent only if no direct channel' },
    'wholesale_lot': { name: 'Alfa Gros / JemlaMaroc', contact: '0630000011', note: 'electronics wholesale lot' },
    'Électronique wholesale': { name: 'Alfa Gros / JemlaMaroc', contact: '0630000011', note: 'direct Moroccan electronics wholesale (220 units)' },
  };
  for (const [k, v] of Object.entries(catMap)) {
    if (c === k.toLowerCase() || c.includes(k.toLowerCase())) return v;
  }
  for (const L of LEADS) {
    if (c.includes(L.cat)) return L;
  }
  return null;
}

(async () => {
  const items = await db.procurementItem.findMany({
    where: { status: { in: ['sourced', 'ordered', 'purchased', 'wholesale'] } },
    select: { name: true, category: true, status: true, quantity: true, totalEst: true, currency: true, supplierName: true, orderRef: true },
    orderBy: [{ category: 'asc' }],
  });

  const rows: Array<Record<string, unknown>> = [];
  const leadPicks: Record<string, number> = {};
  for (const it of items) {
    const lead = matchLead(it.category, it.name)
      || (String(it.supplierName || '').toLowerCase().includes('wholesale')
          ? { name: 'Alfa Gros / JemlaMaroc', contact: '0630000011', note: 'direct Moroccan electronics/wholesale — replace the generic block with a concrete order' }
          : { name: it.supplierName || 'TBD — find local supplier', contact: '', note: '' });
    leadPicks[lead.name] = (leadPicks[lead.name] || 0) + it.quantity;
    rows.push({
      item: it.name,
      category: it.category,
      status: it.status,
      qty: it.quantity,
      estUsd: it.currency === 'USD' ? it.totalEst : it.totalEst,
      currSup: it.supplierName || '',
      existingRef: it.orderRef || '',
      action: (it.status === 'sourced' || it.status === 'wholesale') ? 'PLACE ORDER' : (it.status === 'ordered' ? 'CHASE SHIPMENT (enter orderRef+tracking)' : 'ENTER REAL SUPPLIER + orderRef'),
      recommendedSupplier: lead.name,
      contact: lead.contact,
      note: lead.note,
    });
  }

  const header = 'item,category,status,qty,estUsd,currentSupplier,existingRef,action,recommendedSupplier,contact,note';
  const csv = [header, ...rows.map(r => [r.item, r.category, r.status, r.qty, r.estUsd, r.currSup, r.existingRef, r.action, r.recommendedSupplier, r.contact, r.note].map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  writeFileSync('data/out/order-placement-worklist.csv', csv);

  console.log(`Wrote ${rows.length} actionable rows -> data/out/order-placement-worklist.csv`);
  console.log('\n=== Supplier concentration (qty units per recommended supplier) ===');
  const sorted = Object.entries(leadPicks).sort((a, b) => b[1] - a[1]);
  for (const [s, q] of sorted) console.log(`  ${String(s).padEnd(40)} ${q} units`);
  await db.$disconnect();
})();
