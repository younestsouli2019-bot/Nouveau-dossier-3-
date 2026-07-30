#!/usr/bin/env node
export async function injectGoogleSSO() {
  const clientId = process.env.GOOGLE_CLIENT_ID || null;
  console.log(JSON.stringify({ status: clientId ? 'CONFIGURED' : 'NO_CLIENT_ID', reason: clientId ? 'Google SSO ready' : 'GOOGLE_CLIENT_ID not set', timestamp: new Date().toISOString() }));
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) injectGoogleSSO();
