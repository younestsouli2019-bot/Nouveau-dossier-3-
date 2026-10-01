#!/usr/bin/env node
/**
 * rwc-flush-pending-deliveries.mjs
 *
 * Replays delivery for course orders recorded in the ledger with
 * delivery === "PENDING" (e.g. orders captured before RESEND_API_KEY existed).
 *
 * Usage:
 *   RESEND_API_KEY=rk_... node scripts/rwc-flush-pending-deliveries.mjs
 *   RWC_RESEND_ENDPOINT=http://127.0.0.1:PORT/emails ...   # test hook (mock provider)
 *   node scripts/rwc-flush-pending-deliveries.mjs --dry-run # report only, no sends
 *
 * Reads data/out/course-orders.ndjson, sends the receipt email for each
 * pending order, and rewrites the ledger line to delivery=SENT.
 * Idempotent: SENT orders are skipped; a failed send stays PENDING.
 */
import fs from 'node:fs';
import path from 'node:path';

const LEDGER = process.env.RWC_ORDERS_LEDGER || path.join(process.cwd(), 'data', 'out', 'course-orders.ndjson');
const FROM = process.env.RWC_RECEIPT_FROM || 'RealWorldCerts <billing@realworldcerts.com>';
const ENDPOINT = process.env.RWC_RESEND_ENDPOINT || 'https://api.resend.com/emails';
const DRY_RUN = process.argv.includes('--dry-run');

function receiptHtml(o) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="color:#0a2540">Your course access: ${o.title}</h2>
    <p>Your payment of <strong>${Number(o.amount_total).toFixed(2)} ${String(o.currency).toUpperCase()}</strong> was received. This is your receipt — keep it for your records.</p>
    <p>Your full practice-test bank and lifetime-access instructions follow in a separate email from our delivery team.</p>
    <p style="margin-top:24px">Questions? Reply to this email or write to <a href="mailto:billing@realworldcerts.com">billing@realworldcerts.com</a>.</p>
    <p style="color:#666;font-size:12px;margin-top:32px">RealWorldCerts · Order ref: ${o.slug}</p>
  </div>`;
}

async function main() {
  if (!process.env.RESEND_API_KEY && !DRY_RUN) {
    console.error('RESEND_API_KEY is not set — nothing to send with. Aborting.');
    process.exit(1);
  }
  if (!fs.existsSync(LEDGER)) {
    console.log('No ledger file yet — nothing to flush.');
    return;
  }
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
  let pending = 0, sent = 0, failed = 0;
  const out = [];

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { out.push(line); continue; }
    if (o.delivery !== 'PENDING' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(o.email || ''))) {
      out.push(line);
      continue;
    }
    pending++;
    if (DRY_RUN) {
      console.log(`[dry-run] would send to ${o.email} for "${o.title}" (${o.session_id})`);
      out.push(line);
      continue;
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [o.email],
          subject: `Your course access: ${o.title}`,
          html: receiptHtml(o),
        }),
      });
      if (res.ok) {
        o.delivery = 'SENT';
        o.delivery_detail = 'flushed by replay script';
        sent++;
      } else {
        failed++;
        console.error(`Resend ${res.status} for session ${o.session_id}`);
      }
    } catch (e) {
      failed++;
      console.error('Send failed for session', o.session_id, String(e));
    }
    out.push(JSON.stringify(o));
  }

  if (!DRY_RUN) fs.writeFileSync(LEDGER, out.join('\n') + '\n', 'utf8');
  console.log(`Pending: ${pending} → sent: ${sent}, failed: ${failed}, skipped/other: ${lines.length - pending}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
