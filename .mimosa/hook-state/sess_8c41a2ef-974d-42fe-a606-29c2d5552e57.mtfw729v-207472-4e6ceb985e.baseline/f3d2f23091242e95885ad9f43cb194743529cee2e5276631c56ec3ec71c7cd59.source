/**
 * Carrier API autonomous acquisition sweep.
 *
 * Hands-free policy: autonomously wire whatever carrier capability is available
 * now, report honestly what needs owner-supplied keys, and NEVER fabricate
 * tracking events.
 *
 * Actions:
 *  1. Detect which premium carrier keys are present (SHIP24_API_KEY,
 *     NINE_TRACKING_KEY) and report missing ones.
 *  2. For shipments with a trackingNumber: run keyless autodetect, set a real
 *     public tracking URL + carrier. Tracking stays UNVERIFIED (no invented events).
 *  3. Neutralize fabricated placeholder carriers ("International Shipping",
 *     "Multi-carrier (...)") left by seed scripts — those labels assert shipment
 *     activity that never happened.
 *  4. Write outcome to AutoPilotRun for the telemetry feed.
 */
import { PrismaClient } from '@prisma/client';
import { autodetectCarrier } from '../src/lib/procurement/carrier-router';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e: any) {
      const msg = String((e?.message) || e || '');
      if (msg.includes('reach database server') || msg.includes('ECONNREFUSED')) { await sleep(4000); continue; }
      throw e;
    }
  }
  throw new Error('Neon unreachable after retries');
}

const FABRICATED_CARRIERS = /international shipping|multi-carrier/i;

async function main() {
  const t0 = Date.now();
  const report: Record<string, unknown> = {};

  // 1. Key presence
  const keys = {
    ship24: !!process.env.SHIP24_API_KEY,
    nineTracking: !!process.env.NINE_TRACKING_KEY,
  };
  report.keyPresence = keys;
  report.missingKeys = Object.entries(keys).filter(([, v]) => !v).map(([k]) => k);
  console.log('Carrier keys present:', JSON.stringify(keys));
  console.log('Missing premium keys (owner-supplied, optional):', report.missingKeys);

  // 2. Shipments with a tracking number -> keyless autodetect
  const withTracking = await withRetry(() => prisma.shipment.findMany({
    where: { trackingNumber: { not: null } },
    select: { id: true, shipmentNumber: true, trackingNumber: true, carrier: true, trackingUrl: true },
  }));
  console.log('shipments with trackingNumber:', withTracking.length);
  let keylessUpdated = 0;
  for (const s of withTracking) {
    const probe = autodetectCarrier(s.trackingNumber!);
    if (probe && probe.known) {
      await withRetry(() => prisma.shipment.update({
        where: { id: s.id },
        data: { carrier: probe.carrier, trackingUrl: probe.publicUrl, trackingVerified: false },
      }));
      keylessUpdated++;
    }
  }
  report.keylessUpdated = keylessUpdated;
  console.log('keyless carrier+URL applied:', keylessUpdated);

  // 3. Neutralize fabricated placeholder carriers
  const fabricated = await withRetry(() => prisma.shipment.findMany({
    where: { carrier: { not: null } },
    select: { id: true, carrier: true, trackingNumber: true },
    take: 500,
  }));
  const toFix = fabricated.filter(s => !s.trackingNumber && s.carrier && FABRICATED_CARRIERS.test(s.carrier));
  console.log('fabricated placeholder carriers to neutralize:', toFix.length);
  for (const s of toFix.slice(0, 200)) {
    await withRetry(() => prisma.shipment.update({
      where: { id: s.id },
      data: { carrier: null, trackingUrl: null, trackingVerified: false },
    }));
  }
  report.fabricatedCarriersNeutralized = toFix.length;

  // 4. Log to AutoPilotRun
  await withRetry(() => prisma.autoPilotRun.create({
    data: {
      trigger: 'carrier-acquire-sweep',
      phase: 'carrier-api-acquisition',
      status: 'completed',
      itemsAffected: keylessUpdated + toFix.length,
      details: JSON.stringify(report),
      durationMs: Date.now() - t0,
    },
  }));
  console.log('AutoPilotRun logged.');
}

main().catch(e => { console.log('\nERR', String((e?.message && e.stack) || e).slice(0, 3000)); process.exit(1); });