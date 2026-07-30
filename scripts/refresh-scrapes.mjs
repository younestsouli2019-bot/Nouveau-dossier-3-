#!/usr/bin/env node
export async function refreshScrapes() {
  console.log(JSON.stringify({ status: 'SKIPPED', reason: 'not yet implemented', timestamp: new Date().toISOString() }));
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) refreshScrapes();
