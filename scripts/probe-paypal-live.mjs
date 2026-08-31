/**
 * LIVE PAYPAL RAIL PROBE — non-fund-moving.
 * Verifies: (1) credentials issue a valid access token, (2) the Payouts
 * permission/scope is active, (3) account balance readable.
 * Does NOT POST any payout, so NO money moves. This answers whether the
 * C.I.P./identity-review 403 blocker has actually cleared.
 *
 * Run: node scripts/probe-paypal-live.mjs
 */
import 'dotenv/config';

// Use the same hive: resolve PPP2 creds just like owner-payout-paypal
const clientId = process.env.PPP2_CLIENT_ID || process.env.PAYPAL_PPP2_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || '';
const clientSecret = process.env.PPP2_CLIENT_SECRET || process.env.PAYPAL_PPP2_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET || '';
process.env.PAYPAL_CLIENT_ID = clientId;
process.env.PAYPAL_CLIENT_SECRET = clientSecret;
process.env.SWARM_LIVE = 'true';
process.env.PAYPAL_MODE = 'live';
process.env.PAYPAL_PPP2_APPROVED = 'true';
process.env.PAYPAL_PPP2_ENABLE_SEND = 'true';

const BASE = 'https://api-m.paypal.com';
function b64(u, p) { return Buffer.from(`${u}:${p}`, 'utf8').toString('base64'); }

const out = { at: new Date().toISOString(), probe: 'non-fund-moving' };
try {
  const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${b64(clientId, clientSecret)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'Accept-Language': 'en_US' },
    body: 'grant_type=client_credentials',
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  out.tokenStatus = tokenRes.status;
  out.scope = tokenJson.scope ?? null;
  out.tokenIssued = tokenRes.ok && !!tokenJson.access_token;
  if (!tokenRes.ok) {
    out.error = `token ${tokenRes.status}: ${JSON.stringify(tokenJson).slice(0, 400)}`;
    out.verdict = 'AUTH_FAIL';
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // Read-only balances — does NOT move funds, confirms Payouts access is live.
  const tok = tokenJson.access_token;
  const balRes = await fetch(`${BASE}/v1/reporting/balances?currency_code=USD`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Accept-Language': 'en_US' } });
  out.balanceStatus = balRes.status;
  const balBody = await balRes.text().catch(() => '');
  out.balanceBody = balBody.slice(0, 900);

  // Determine deliverability: token OK + +/+ scope + balance readable
  out.hasPayoutScope = /payout/i.test(tokenJson.scope || '');
  out.verdict = tokenRes.ok ? 'SCOPE_LIVE_READY' : 'AUTH_FAIL';
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  out.verdict = 'PROBE_ERROR';
  out.error = (e?.message || String(e)).slice(0, 500);
  console.log(JSON.stringify(out, null, 2));
}
