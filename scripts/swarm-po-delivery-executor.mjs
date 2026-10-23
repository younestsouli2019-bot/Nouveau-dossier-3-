#!/usr/bin/env node
/**
 * SWARM PO DELIVERY EXECUTOR — fail-closed.
 *
 * Records owner PO delivery from REAL evidence only:
 *   - carrier tracking numbers/events  <- PO_CARRIER_TRACKING_FILE (external input)
 *   - proof of delivery                <- a signed scan under PO_RECEIVED_DIR
 *
 * This executor never invents tracking references, carrier events or POD
 * hashes, never marks a shipment delivered without a signed receipt scan, and
 * never auto-commits or auto-pushes. Missing evidence is a hard stop
 * (NG2 doctrine, art. 388 CPP — see reports/po-gaps-v358.md).
 *
 * Run:
 *   DATABASE_URL=<neon-url> OWNER_EXEC_UNLOCK=<16chars+> \
 *   PO_CARRIER_TRACKING_FILE=data/out/po/carrier-tracking.json \
 *   node scripts/swarm-po-delivery-executor.mjs
 *
 * Tracking file shape:
 *   { "SWARM-PO-2026-001": { "carrier": "AMANA", "trackingNumber": "EE123456789MA",
 *                            "events": [ { "timestamp": "...", "status": "in_transit", "location": "Rabat" } ] } }
 */
import 'dotenv/config';
import { runPoDeliveryCli } from './lib/po-delivery.mjs';

const code = await runPoDeliveryCli({
  performedBy: 'swarm-po-delivery-executor',
  reportPath: `data/out/po/po-delivery-executor-${new Date().toISOString().slice(0, 10)}.json`,
});

process.exit(code);
