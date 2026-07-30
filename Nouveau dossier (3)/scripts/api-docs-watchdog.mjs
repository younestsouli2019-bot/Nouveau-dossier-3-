#!/usr/bin/env node
export async function apiDocsWatchdog() {
  const endpoints = [
    { name: 'orchestrator', url: process.env.ORCHESTRATOR_URL || 'http://localhost:3001/health' },
    { name: 'contingency', url: process.env.CONTINGENCY_URL || 'http://localhost:3002/health' },
    { name: 'registry', url: process.env.REGISTRY_URL || 'http://localhost:3003/health' },
  ];
  const results = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(5000) });
      results.push({ endpoint: ep.name, url: ep.url, status: res.ok ? 'UP' : 'DEGRADED', httpStatus: res.status, timestamp: new Date().toISOString() });
    } catch {
      results.push({ endpoint: ep.name, url: ep.url, status: 'DOWN', httpStatus: null, timestamp: new Date().toISOString() });
    }
  }
  const report = { timestamp: new Date().toISOString(), checks: results, allUp: results.every(r => r.status === 'UP') };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))) apiDocsWatchdog();
