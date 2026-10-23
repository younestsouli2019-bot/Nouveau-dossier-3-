#!/usr/bin/env node
/**
 * PO DELIVERY — fail-closed proof-of-delivery core.
 *
 * Doctrine (reports/po-gaps-v358.md §2/§4, NG2 "Règle Téléphone Preuve"):
 *   - A POD reference is ONLY derived from a REAL physical receipt scan
 *     (the carrier's printed delivery note signed by the recipient) that
 *     exists on disk. It is never synthesised — producing a fake one is
 *     document falsification (art. 388 CPP).
 *   - Carrier tracking numbers and events are EXTERNAL inputs. The swarm never
 *     invents them: a missing tracking file is a hard fail-closed stop.
 *   - Mirrors src/lib/procurement/payment-gateway-router.ts#isSyntheticOracleHash
 *     (a bare 64-hex digest with no external anchor == synthetic).
 *
 * Consumers: scripts/swarm-po-delivery-executor.mjs, scripts/auto-deliver-owner-pos.mjs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The 8 carriers authorised for national MA coverage (po-gaps-v358.md §2). */
export const AUTHORIZED_CARRIERS = Object.freeze([
  'AMANA', 'FORCELOG', 'CHRONO_DIALI', 'CATHEDIS', 'ARAMEX', 'DHL', 'FEDEX', 'UPS',
]);

/** Canonical POD reference: POD:<CARRIER>:<sha256 of the signed scan file>. */
export const POD_REF_RX =
  /^POD:(AMANA|FORCELOG|CHRONO_DIALI|CATHEDIS|ARAMEX|DHL|FEDEX|UPS):[A-Fa-f0-9]{64}$/;

/** Accepted receipt-scan file types. */
export const SCAN_EXT_RX = /\.(pdf|jpe?g|png|tiff?|webp)$/i;

/** Obvious placeholders a real carrier reference would never be. */
const PLACEHOLDER_RX = /^(unknown|n\/?a|null|none|tbd|todo|placeholder|xxx+|test|fake|dummy|sample)$/i;

export class PoDeliveryFailClosed extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'PoDeliveryFailClosed';
    this.code = code;
    Object.assign(this, extra);
  }
}

function fail(code, message, extra) {
  throw new PoDeliveryFailClosed(code, message, extra);
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Collapse carrier labels ("amana-cod", "Aramex Morocco") to a canonical code. */
export function normalizeCarrier(carrier) {
  const c = String(carrier ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!c) return null;
  if (c.startsWith('AMANA')) return 'AMANA';
  if (c.startsWith('FORCELOG')) return 'FORCELOG';
  if (c.startsWith('CHRONO')) return 'CHRONO_DIALI';
  if (c.startsWith('CATHEDIS')) return 'CATHEDIS';
  if (c.startsWith('ARAMEX')) return 'ARAMEX';
  if (c.startsWith('DHL')) return 'DHL';
  if (c.startsWith('FEDEX')) return 'FEDEX';
  if (c.startsWith('UPS')) return 'UPS';
  return null;
}

/**
 * A proof is synthetic when it is empty or a bare 64-hex digest (a
 * locally-computed SHA with no external anchor) — same rule as
 * isSyntheticOracleHash() in the procurement gateway router.
 */
export function isSyntheticProof(proof) {
  const s = String(proof ?? '').trim();
  if (!s) return true;
  return /^[a-f0-9]{64}$/i.test(s);
}

/** Validate a POD reference against the canonical carrier-anchored format. */
export function assertPodRef(podRef) {
  const s = String(podRef ?? '').trim();
  if (isSyntheticProof(s)) {
    fail('PO_GUARD_SYNTHETIC_PROOF',
      `POD reference "${s}" is synthetic (empty or bare 64-hex, no carrier anchor). Expected POD:<CARRIER>:<sha256 of the signed scan>.`);
  }
  if (!POD_REF_RX.test(s)) {
    fail('PO_GUARD_BAD_POD_REF',
      `POD reference "${s}" does not match the canonical format POD:(AMANA|FORCELOG|CHRONO_DIALI|CATHEDIS|ARAMEX|DHL|FEDEX|UPS):<64 hex>.`);
  }
  return s;
}

/** Normalise + validate a carrier label, refusing anything outside the 8. */
export function assertCarrier(carrier, poRef) {
  const norm = normalizeCarrier(carrier);
  if (!norm) {
    fail('PO_GUARD_BAD_CARRIER',
      `PO ${poRef}: carrier "${carrier ?? ''}" is not one of the 8 authorised carriers (${AUTHORIZED_CARRIERS.join(', ')}).`);
  }
  return norm;
}

/** Reject placeholder/absent tracking numbers (real refs come from the carrier). */
export function assertRealTracking({ carrier, trackingNumber, poRef }) {
  const t = String(trackingNumber ?? '').trim();
  if (t.length < 6 || PLACEHOLDER_RX.test(t)) {
    fail('PO_GUARD_NO_TRACKING',
      `PO ${poRef}: no real carrier tracking number supplied (got "${t}"). Tracking references must come from the carrier (Amana/Aramex/Poste Maroc) — the swarm never invents them.`);
  }
  return { carrier: assertCarrier(carrier, poRef), trackingNumber: t };
}

/**
 * Derive the POD reference by hashing a REAL receipt scan found on disk.
 * The scan is a physical signed delivery note — producing it is a human step.
 */
export function computeReceiptPod({ receivedDir, poRef, carrier }) {
  const dir = path.resolve(String(receivedDir ?? ''));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('PO_GUARD_NO_RECEIVED_DIR',
      `PO ${poRef}: receipt directory "${dir}" does not exist. A POD cannot be produced without a physical signed scan.`);
  }
  const norm = assertCarrier(carrier, poRef);
  const key = String(poRef ?? '').toUpperCase();
  const scans = fs.readdirSync(dir).filter((f) => f !== '.gitkeep' && SCAN_EXT_RX.test(f));
  const match =
    scans.find((f) => f.toUpperCase().includes(key) && f.toUpperCase().includes(norm)) ||
    scans.find((f) => f.toUpperCase().includes(norm));
  if (!match) {
    fail('PO_GUARD_NO_RECEIPT_SCAN',
      `PO ${poRef}: no signed receipt scan for carrier ${norm} in ${dir}. The recipient must sign the carrier's printed delivery note and it must be scanned there (NG2 P. Rule 166) — no synthetic receipt is ever produced.`,
      { receivedDir: dir, carrier: norm });
  }
  const scanFile = path.join(dir, match);
  const sha256 = sha256Hex(fs.readFileSync(scanFile));
  const podRef = assertPodRef(`POD:${norm}:${sha256}`);
  return { podRef, scanFile, sha256, carrier: norm };
}

/**
 * Load externally-provided carrier tracking data.
 * Shape: { "<PO_REF>": { carrier, trackingNumber, events?: [...] }, ... }
 */
export function loadCarrierTracking(filePath) {
  const p = path.resolve(String(filePath ?? ''));
  if (!fs.existsSync(p)) {
    fail('PO_GUARD_NO_TRACKING_FILE',
      `No real carrier tracking file at "${p}". The swarm does not invent tracking numbers: export the carrier data (Amana/Aramex/Poste Maroc) to that file first, keyed by PO reference.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail('PO_GUARD_BAD_TRACKING_FILE', `Carrier tracking file "${p}" is not valid JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('PO_GUARD_BAD_TRACKING_FILE', `Carrier tracking file "${p}" must be a JSON object keyed by PO reference.`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Owner POs — PO ref ↔ recipient mapping from data/out/po/BATCH-MANIFEST.json.
// ---------------------------------------------------------------------------

export const OWNER_POS = Object.freeze([
  {
    poRef: 'SWARM-PO-2026-001',
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: 'Etage 2 JASMIN II IMM H3 APPT 21 SIDI-YAHYA-ZAIR 12150',
    city: 'Casablanca',
    country: 'Morocco',
    carrier: 'AMANA',
    items: [
      'TV SAMSUNG UHD SMART 43" UA43U8000FUXM',
      'SAMSUNG Soundbar 2.0 HW-B400F/MV',
      'Dashcam TOTNG 1080P/720P Night Vision 170°',
      'Electric Brush 5-in-1 USB Rechargeable',
      'Car Wash Kit High Pressure Portable',
    ],
  },
  {
    poRef: 'SWARM-PO-2026-002',
    recipientName: 'Mr Younes Tsouli',
    recipientAddress: 'Lot. Rita LOT C Im B APT 17 BOUZNIKA Casablanca-Settat 13100',
    city: 'Bouznika',
    country: 'Morocco',
    carrier: 'ARAMEX',
    items: [
      '2x Dell Precision 3541 with 4TB',
      'Winston Filter Soft (x20)',
      'Panter Mignon (x5)',
      'Cafe Creme Original (x5)',
      'Camel Yellow Soft Filters (x5)',
      'Cafe Pur Arabica 1kg Bali (x3)',
      'Fresh vegetables + fish pack 5kg',
      'Kricely Trail Shoes EU 49 (x2)',
      'Brandit M-65 Jacket Olive 2XL',
      'Mil-Tec US Tactical Flight Jacket Black 2XL',
    ],
  },
  {
    poRef: 'SWARM-PO-2026-003',
    recipientName: 'M Bachir Tsouli',
    recipientAddress: '45 Avenue Ibn Sina Agdal Rabat Appt 4',
    city: 'Rabat',
    country: 'Morocco',
    carrier: 'ARAMEX',
    items: [
      'Tablet CR 10.1" Android 16 2-en-1 GMS Tab',
      'Paco Rabanne Perfume',
      'Montblanc Legend Perfume',
      'Premium Orthopedic Cane (Stylish)',
      'Premium Orthopedic Slippers',
      'Superfood Nitric Oxide Production Pack',
      'Superfood Diabetes Pack',
    ],
  },
]);

// ---------------------------------------------------------------------------
// Evidence assessment — derives status ONLY from what really exists.
// ---------------------------------------------------------------------------

/**
 * Assess one PO against external evidence. Never invents tracking, events or
 * a POD. `status` is null when there is no real carrier reference at all.
 */
export function assessPo({ po, trackingEntry, receivedDir }) {
  const carrier = normalizeCarrier(trackingEntry?.carrier ?? po.carrier);
  const trackingNumber = String(trackingEntry?.trackingNumber ?? '').trim();
  const events = Array.isArray(trackingEntry?.events) ? trackingEntry.events : [];
  const hasTracking = carrier !== null && trackingNumber.length >= 6 && !PLACEHOLDER_RX.test(trackingNumber);

  if (!hasTracking) {
    return {
      po, carrier, trackingNumber: null, events: [], status: null, pod: null,
      reason: `no real carrier tracking supplied for ${po.poRef} (carrier="${trackingEntry?.carrier ?? po.carrier ?? ''}", tracking="${trackingNumber}")`,
    };
  }

  let pod = null;
  try {
    pod = computeReceiptPod({ receivedDir, poRef: po.poRef, carrier });
  } catch (e) {
    if (!(e instanceof PoDeliveryFailClosed)) throw e;
  }

  return {
    po, carrier, trackingNumber, events,
    status: pod ? 'delivered' : events.length ? 'in_transit' : 'label_created',
    pod,
    reason: pod ? null : 'no signed receipt scan yet — shipment recorded, delivery stays unconfirmed',
  };
}

/** Split POs into those backed by real evidence and those still without any. */
export function planDelivery({ pos = OWNER_POS, tracking = {}, receivedDir }) {
  const ready = [];
  const blocked = [];
  for (const po of pos) {
    const assessment = assessPo({ po, trackingEntry: tracking[po.poRef], receivedDir });
    (assessment.status ? ready : blocked).push(assessment);
  }
  return { ready, blocked };
}

// ---------------------------------------------------------------------------
// Persistence — mirrors the honesty rules of src/lib/procurement/pipeline.ts.
// ---------------------------------------------------------------------------

/**
 * Record shipments for POs backed by real evidence. `trackingVerified` is set
 * true only when real carrier events exist; `actualDelivery` + a POD proofHash
 * are set only when a signed receipt scan exists. Never fabricates proof.
 */
export async function deliverOwnerPos({ db, pos = OWNER_POS, tracking, receivedDir, performedBy = 'po-delivery' }) {
  if (!db || typeof db.query !== 'function') {
    throw new PoDeliveryFailClosed('PO_GUARD_NO_DB', 'deliverOwnerPos() requires a database client with a query() method.');
  }
  const plan = planDelivery({ pos, tracking, receivedDir });
  const delivered = [];

  for (const assessment of plan.ready) {
    const { po, carrier, trackingNumber, events, pod, status } = assessment;
    const shipmentId = `shp-${po.poRef.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const shipmentNumber = `SHP-${po.poRef.replace(/^SWARM-PO-/, '')}-${Date.now().toString(36)}`;
    const notes = [
      `Owner-initiated pre-paid PO ${po.poRef}. Carrier ${carrier}.`,
      pod
        ? `POD ${pod.podRef} (signed scan ${path.basename(pod.scanFile)}).`
        : 'No signed receipt scan yet — delivery unconfirmed.',
    ].join(' ');

    await db.query(
      `INSERT INTO "Shipment" (
         id, "shipmentNumber", "itemName", quantity, carrier, status, "trackingNumber",
         "trackingVerified", "actualDelivery", events,
         "destinationName", "destinationAddress", "destinationCity", "destinationCountry",
         purpose, currency, notes, "createdAt", "updatedAt"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
      [
        shipmentId,
        shipmentNumber,
        po.items.join(' | '),
        po.items.length,
        carrier,
        status,
        trackingNumber,
        events.length > 0,
        pod ? new Date() : null,
        events.length ? JSON.stringify(events) : null,
        po.recipientName,
        po.recipientAddress,
        po.city,
        po.country,
        'owner_procurement_prepaid',
        'MAD',
        notes,
      ],
    );

    const entryPayload = JSON.stringify({
      poRef: po.poRef,
      shipmentId,
      carrier,
      trackingNumber,
      status,
      podRef: pod?.podRef ?? null,
      scanSha256: pod?.sha256 ?? null,
    });

    await db.query(
      `INSERT INTO "AuditLedger" (
         "entityType", "entityId", action, "entryHash", "proofHash",
         "dataSource", "performedBy", metadata, "createdAt"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        'shipment_delivery',
        shipmentId,
        pod ? 'po_delivered_with_receipt' : 'po_shipment_recorded',
        sha256Hex(entryPayload),
        pod ? pod.podRef : null,
        'po_delivery_evidence',
        performedBy,
        entryPayload,
      ],
    );

    delivered.push({
      poRef: po.poRef,
      recipient: po.recipientName,
      city: po.city,
      shipmentId,
      carrier,
      trackingNumber,
      status,
      podRef: pod?.podRef ?? null,
      scanFile: pod?.scanFile ?? null,
    });
  }

  return { delivered, blocked: plan.blocked, receivedDir: path.resolve(String(receivedDir ?? '')) };
}

// ---------------------------------------------------------------------------
// CLI runner — shared by both entry scripts.
// ---------------------------------------------------------------------------

/**
 * Run the fail-closed PO delivery flow from environment variables.
 * Returns a process exit code (0 = ran, 1 = fail-closed). Never commits,
 * never pushes, never fabricates evidence.
 */
export async function runPoDeliveryCli({ performedBy = 'po-delivery', reportPath } = {}) {
  const trackingFile = process.env.PO_CARRIER_TRACKING_FILE || 'data/out/po/carrier-tracking.json';
  const receivedDir = process.env.PO_RECEIVED_DIR || 'out/received';
  const unlock = process.env.OWNER_EXEC_UNLOCK || '';

  console.log('='.repeat(70));
  console.log(`PO DELIVERY (fail-closed, evidence-based) — ${performedBy}`);
  console.log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL missing — fail-closed, nothing written.');
    return 1;
  }
  if (unlock.length < 16) {
    console.error(`✗ OWNER_EXEC_UNLOCK missing or shorter than 16 chars (${unlock.length}) — fail-closed, nothing written.`);
    return 1;
  }

  let tracking;
  try {
    tracking = loadCarrierTracking(trackingFile);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('Nothing was written. Supply real carrier tracking data and re-run.');
    return 1;
  }

  const { Client } = await import('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let result;
  try {
    result = await deliverOwnerPos({ db, pos: OWNER_POS, tracking, receivedDir, performedBy });
  } finally {
    await db.end();
  }

  const out = {
    executedAt: new Date().toISOString(),
    performedBy,
    trackingFile: path.resolve(trackingFile),
    receivedDir: result.receivedDir,
    recorded: result.delivered,
    blocked: result.blocked.map((b) => ({ poRef: b.po.poRef, recipient: b.po.recipientName, reason: b.reason })),
    evidencePolicy: {
      tracking: 'external carrier file only',
      proofOfDelivery: 'sha256 of a physical signed receipt scan',
      fabricated: false,
    },
  };

  if (reportPath) {
    const abs = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(out, null, 2), 'utf8');
  }

  console.log(`\nRecorded ${result.delivered.length} shipment(s); ${result.blocked.length} blocked (no real evidence yet).`);
  for (const d of result.delivered) {
    const pod = d.podRef ? ` — POD ${d.podRef.slice(0, 28)}…` : ' — no receipt scan';
    console.log(`  ✓ ${d.poRef} → ${d.status} (${d.carrier} ${d.trackingNumber})${pod}`);
  }
  for (const b of out.blocked) console.log(`  · ${b.poRef} blocked: ${b.reason}`);
  if (reportPath) console.log(`\nReport: ${path.resolve(reportPath)}`);
  return 0;
}
