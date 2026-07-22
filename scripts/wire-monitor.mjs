#!/usr/bin/env node

/**
 * ⚠️ DEPRECATED — Use settle-cron.mjs instead
 * 
 * This script is superseded by:
 *   scripts/settle-cron.mjs  (runs auto-settle-owner.mjs every 5 min)
 *   scripts/auto-settle-owner.mjs  (consolidated settlement pipeline)
 * 
 * Kept for reference only. Do not run.
 */

console.error("⚠️  wire-monitor.mjs is DEPRECATED.");
console.error("   Use: node scripts/settle-cron.mjs");
console.error("   Or:  node scripts/auto-settle-owner.mjs");
process.exit(1);
