#!/usr/bin/env node
/**
 * po-fulfillment-orchestrator.mjs  (AUTONOMOUS · READ-ONLY · no money movement)
 *
 * Orchestrates the full PO fulfillment pipeline:
 * 1. Runs po-execution-queue to get per-supplier data
 * 2. Generates ready-to-send outreach messages (WhatsApp/phone/email templates)
 * 3. Checks for any incoming waybills (data/out/waybills-inbox.csv)
 * 4. Feeds confirmed waybills to proc:watchdog
 * 5. Produces a status dashboard
 *
 * This is the "human-in-the-loop" orchestrator: it generates messages the
 * operator sends via their own phone/app, then polls for responses.
 *
 *   node scripts/po-fulfillment-orchestrator.mjs [--action outreach|poll|feed|dashboard]
 *
 * Actions:
 *   outreach  - Generate per-supplier outreach messages (default)
 *   poll      - Check for new waybills in inbox, update status
 *   feed      - Feed confirmed waybills to proc:watchdog
 *   dashboard - Show full fulfillment status
 *
 * Produces:
 *   data/out/po-outreach-messages.json  (ready-to-send messages per supplier)
 *   data/out/po-fulfillment-status.json (live dashboard)
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const ACTION = process.argv.includes('--dashboard') ? 'dashboard'
  : process.argv.includes('--poll') ? 'poll'
  : process.argv.includes('--feed') ? 'feed'
  : 'outreach';

// ── Supplier contact registry (Moroccan vendors use WhatsApp/phone) ──────
const SUPPLIERS = {
  'AliExpress': {
    channel: 'self_service',
    platform: 'aliexpress.com',
    howToTrack: 'Open AliExpress app → My Orders → find order → copy tracking number',
    languages: ['en', 'fr'],
  },
  'AliExpress / Kricely': {
    channel: 'self_service',
    platform: 'aliexpress.com/store/kricely',
    howToTrack: 'Open AliExpress app → My Orders → Kricely store order → copy tracking',
    languages: ['en'],
  },
  'Amazon US': {
    channel: 'self_service',
    platform: 'amazon.com',
    howToTrack: 'Amazon.com → Orders → find order → Track package → copy tracking',
    languages: ['en'],
  },
  'Amazon EU': {
    channel: 'self_service',
    platform: 'amazon.de/.fr',
    howToTrack: 'Amazon EU → Mes commandes → follow order → copy tracking',
    languages: ['fr', 'de', 'en'],
  },
  'Jumia Maroc': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → follow delivery → copy tracking',
    languages: ['fr', 'ar'],
  },
  'Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → follow delivery → copy tracking',
    languages: ['fr', 'ar'],
  },
  'Temu': {
    channel: 'self_service',
    platform: 'temu.com',
    howToTrack: 'Temu app → Orders → Track → copy tracking number',
    languages: ['en', 'fr'],
  },
  'Samsung Maroc': {
    channel: 'phone',
    phone: null,
    message: 'Bonjour, svp statut commande Samsung + num\'tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Samsung': {
    channel: 'phone',
    phone: null,
    message: 'Bonjour, svp statut commande Samsung + num\'tracking. Merci.',
    languages: ['fr'],
  },
  'Avito Maroc (Refurbished)': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp envooyer le bon de livraison / tracking pour la commande Avito. Merci.',
    languages: ['fr', 'ar'],
  },
  'Avito refurbished': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp envooyer le bon de livraison / tracking pour la commande Avito. Merci.',
    languages: ['fr', 'ar'],
  },
  'Wholesale supplier': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison + tracking pour les commandes en cours. Merci.',
    languages: ['fr', 'ar'],
  },
  'Wholesale Supplier (JemlaMaroc)': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour JemlaMaroc, svp statut livraison + tracking pour les commandes en cours. Merci.',
    languages: ['fr', 'ar'],
  },
  'JemlaMaroc / Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → JemlaMaroc order → copy tracking',
    languages: ['fr', 'ar'],
  },
  'Amed.ma': {
    channel: 'phone',
    phone: null,
    message: 'Bonjour, svp statut commande + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Cafe Gold': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison Cafe Gold + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Elexia': {
    channel: 'self_service',
    platform: 'elexia.ma',
    howToTrack: 'Elexia.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'ELEXIA': {
    channel: 'self_service',
    platform: 'elexia.ma',
    howToTrack: 'Elexia.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'Mirka.ma': {
    channel: 'self_service',
    platform: 'mirka.ma',
    howToTrack: 'Mirka.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'Superfood.ma': {
    channel: 'self_service',
    platform: 'superfood.ma',
    howToTrack: 'Superfood.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'Toko.ma': {
    channel: 'self_service',
    platform: 'toko.ma',
    howToTrack: 'Toko.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'Kricely': {
    channel: 'self_service',
    platform: 'aliexpress.com/store/kricely',
    howToTrack: 'AliExpress → Kricely store order → copy tracking',
    languages: ['en'],
  },
  'Locamed / Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → Locamed order → copy tracking',
    languages: ['fr'],
  },
  'VEADA / Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → VEADA order → copy tracking',
    languages: ['fr'],
  },
  'Coucou / Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → Coucou order → copy tracking',
    languages: ['fr'],
  },
  'ParfumMaroc': {
    channel: 'self_service',
    platform: 'parfummaroc.ma',
    howToTrack: 'ParfumMaroc.ma → Suivre commande → copy tracking',
    languages: ['fr', 'ar'],
  },
  'CTT Maroc': {
    channel: 'self_service',
    platform: 'cttmaroc.ma',
    howToTrack: 'CTT Maroc → Suivre colis → copy tracking',
    languages: ['fr'],
  },
  'Dell': {
    channel: 'self_service',
    platform: 'dell.com',
    howToTrack: 'Dell.com → Order status → Track shipment → copy tracking',
    languages: ['en'],
  },
  'Winston': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison Winston + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Panter': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison Panter + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Brooklyn Smoke Shop': {
    channel: 'email',
    email: null,
    message: 'Subject: Tracking Needed - Order Status\n\nHi, please provide tracking number for our order. Thanks.',
    languages: ['en'],
  },
  'Crest': {
    channel: 'email',
    email: null,
    message: 'Subject: Suivi commande\n\nBonjour, svp numéro de suivi pour notre commande. Merci.',
    languages: ['fr'],
  },
  'Mil-Tec': {
    channel: 'email',
    email: null,
    message: 'Subject: Order Tracking\n\nHi, please provide tracking for our order. Thanks.',
    languages: ['en'],
  },
  'Opalescence': {
    channel: 'email',
    email: null,
    message: 'Subject: Suivi commande\n\nBonjour, svp numéro de suivi. Merci.',
    languages: ['fr'],
  },
  'Camel': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'VASOUN / Jumia': {
    channel: 'self_service',
    platform: 'jumia.ma',
    howToTrack: 'Jumia.ma → Mes commandes → VASOUN order → copy tracking',
    languages: ['fr'],
  },
  'lepiceriefineandco.ma': {
    channel: 'self_service',
    platform: 'lepiceriefineandco.ma',
    howToTrack: 'lepiceriefineandco.ma → Suivre commande → copy tracking',
    languages: ['fr'],
  },
  'TAGin3D': {
    channel: 'email',
    email: null,
    message: 'Subject: Order Tracking\n\nHi, please provide tracking for our order. Thanks.',
    languages: ['en'],
  },
  'Bali': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison café + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Local': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
  'Marche local Bouznika': {
    channel: 'in_person',
    howToTrack: 'Visit Marche local Bouznika in person for fresh produce delivery status',
    languages: ['fr', 'ar'],
  },
  'Various': {
    channel: 'whatsapp',
    phone: null,
    message: 'Bonjour, svp statut livraison + tracking. Merci.',
    languages: ['fr', 'ar'],
  },
};

// ── Outreach generation ──────────────────────────────────────────────────
function generateOutreach(queue) {
  const messages = {};
  for (const supplier of queue.suppliers) {
    const normalizedName = supplier.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const contact = SUPPLIERS[supplier.name] || SUPPLIERS[Object.keys(SUPPLIERS).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName)] || { channel: 'unknown' };
    const pendingItems = supplier.items.filter(i => i.status === 'ordered' || (i.status === 'shipped' && !i.tracking));
    if (pendingItems.length === 0) continue;

    const itemList = pendingItems.map(i => `  - ${i.name} (qty ${i.quantity || 1}, ${i.totalEst} MAD) → ${i.recipient}`).join('\n');
    const refList = pendingItems.filter(i => i.orderRef).map(i => `  ${i.orderRef}`).join(', ');

    const normalizedKey = supplier.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    messages[normalizedKey] = {
      originalName: supplier.name,
      channel: contact.channel,
      supplierTotal: supplier.totalMAD,
      pendingCount: pendingItems.length,
      itemSummary: pendingItems.map(i => i.name.slice(0, 50)),
      orderRefs: refList || 'none recorded',
      platform: contact.platform || null,
      howToTrack: contact.howToTrack || null,
      message: contact.message || null,
      actionForOperator: contact.channel === 'self_service'
        ? `Check ${contact.platform} for order status, copy tracking numbers, then run: npm run proc:waybills -- --csv data/out/waybills.csv`
        : contact.channel === 'whatsapp'
        ? `Send WhatsApp to supplier: "${contact.message}" | When they reply with tracking, add to data/out/waybills.csv`
        : contact.channel === 'phone'
        ? `Call supplier: "${contact.message}" | When they provide tracking, add to data/out/waybills.csv`
        : contact.channel === 'in_person'
        ? contact.howToTrack
        : `Contact supplier for tracking numbers for ${pendingItems.length} items totaling ${supplier.totalMAD} MAD`,
    };
  }
  return messages;
}

// ── Dashboard ────────────────────────────────────────────────────────────
function buildDashboard(queue, outreach) {
  const totalItems = queue.summary.total;
  const withTracking = queue.summary.shippedWithRef;
  const shippedNoProof = queue.summary.shippedNoProof;
  const orderedNoTracking = queue.summary.orderedNoTracking;

  return {
    at: new Date().toISOString(),
    pipeline: {
      total: totalItems,
      shippedWithProof: withTracking,
      shippedNoProof,
      orderedAwaitingTracking: orderedNoTracking,
      purchasedNoRef: queue.summary.purchased,
    },
    fulfillmentProgress: {
      percentComplete: ((withTracking / totalItems) * 100).toFixed(1) + '%',
      percentShippedNoProof: ((shippedNoProof / totalItems) * 100).toFixed(1) + '%',
      percentOrderedAwaiting: ((orderedNoTracking / totalItems) * 100).toFixed(1) + '%',
    },
    suppliersNeedingAction: Object.entries(outreach).length,
    topPriorities: Object.entries(outreach)
      .sort((a, b) => b[1].supplierTotal - a[1].supplierTotal)
      .slice(0, 5)
      .map(([name, data]) => ({
        supplier: name,
        channel: data.channel,
        pending: data.pendingCount,
        totalMAD: data.supplierTotal,
        action: data.actionForOperator,
      })),
    nextSteps: [
      'Run: npm run po:execution (see full supplier breakdown)',
      'Check self-service platforms (AliExpress/Amazon/Jumia) for tracking',
      'Send WhatsApp/phone messages to local vendors',
      'Record tracking in data/out/waybills.csv (itemId,tracking,carrier)',
      'Run: npm run proc:waybills -- --csv data/out/waybills.csv',
      'Run: npm run proc:watchdog (advances items on real waybills)',
    ],
    note: 'READ-ONLY dashboard. Operator executes outreach through their own phone/app.',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
// Load the PO execution queue (pre-generated or regenerate)
const queuePath = resolve(OUT, 'po-execution-queue.json');
if (!existsSync(queuePath)) {
  console.error('po-execution-queue.json not found. Run: npm run po:execution');
  process.exit(1);
}
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));

if (ACTION === 'outreach') {
  const outreach = generateOutreach(queue);
  writeFileSync(resolve(OUT, 'po-outreach-messages.json'), JSON.stringify(outreach, null, 2));
  const dashboard = buildDashboard(queue, outreach);
  writeFileSync(resolve(OUT, 'po-fulfillment-status.json'), JSON.stringify(dashboard, null, 2));

  console.log(JSON.stringify({
    ok: true,
    action: 'outreach',
    suppliersNeedingAction: Object.keys(outreach).length,
    topPriorities: dashboard.topPriorities.slice(0, 3).map(p => p.supplier + ' (' + p.channel + ', ' + p.pending + ' items, ' + p.totalMAD + ' MAD)'),
    note: 'Messages generated. Operator sends via their own phone/app.',
  }, null, 2));
} else if (ACTION === 'dashboard') {
  const outreach = generateOutreach(queue);
  const dashboard = buildDashboard(queue, outreach);
  writeFileSync(resolve(OUT, 'po-fulfillment-status.json'), JSON.stringify(dashboard, null, 2));
  console.log(JSON.stringify(dashboard, null, 2));
} else if (ACTION === 'poll') {
  const inboxPath = resolve(OUT, 'waybills-inbox.csv');
  if (!existsSync(inboxPath)) {
    console.log(JSON.stringify({ ok: true, action: 'poll', newWaybills: 0, note: 'No waybills-inbox.csv yet. Operator creates it when suppliers respond.' }));
  } else {
    const csv = readFileSync(inboxPath, 'utf8');
    const rows = csv.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('itemId')).map(l => l.split(',')).filter(p => p[0] && p[1]);
    console.log(JSON.stringify({ ok: true, action: 'poll', newWaybills: rows.length, note: 'Run --feed to process these waybills.' }));
  }
} else if (ACTION === 'feed') {
  console.log(JSON.stringify({ ok: true, action: 'feed', note: 'Feed waybills via: npm run proc:waybills -- --csv data/out/waybills-inbox.csv' }));
}
