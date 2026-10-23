#!/usr/bin/env node
/**
 * AUTO-DELIVER OWNER POs — fail-closed.
 *
 * Historical entry point kept for compatibility. It now delegates to the same
 * evidence-based, fail-closed flow as scripts/swarm-po-delivery-executor.mjs:
 * shipments are recorded from EXTERNAL carrier tracking, and a delivery is only
 * confirmed when a signed receipt scan exists on disk (see scripts/lib/po-delivery.mjs).
 * It never fabricates tracking, carrier events or POD references, and never
 * auto-commits or auto-pushes (NG2 doctrine, art. 388 CPP).
 *
 * Run:
 *   DATABASE_URL=<neon-url> OWNER_EXEC_UNLOCK=<16chars+> \
 *   PO_CARRIER_TRACKING_FILE=data/out/po/carrier-tracking.json \
 *   node scripts/auto-deliver-owner-pos.mjs
 */
import 'dotenv/config';
import { runPoDeliveryCli } from './lib/po-delivery.mjs';

const code = await runPoDeliveryCli({
  performedBy: 'auto-deliver-owner-pos',
  reportPath: `data/out/po/auto-deliver-owner-pos-${new Date().toISOString().slice(0, 10)}.json`,
});

process.exit(code);
