/**
 * Ingest paid Shopify orders into an append-only revenue ledger.
 *
 * Dry-run by default. `--apply` appends; idempotent on the Shopify order id.
 * This records revenue only. It never creates payouts or moves money.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fetchPaidOrders, orderKey, type PaidOrder } from '@/lib/shopify/orders';
import { shopifyConfigured } from '@/lib/shopify/client';

const LEDGER = path.join(process.cwd(), 'data', 'out', 'shopify-revenue.ndjson');

async function readKeys(): Promise<{ keys: Set<string>; lastCreatedAt?: string }> {
  try {
    const raw = await fs.readFile(LEDGER, 'utf8');
    const keys = new Set<string>();
    let lastCreatedAt: string | undefined;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { key: string; createdAt?: string };
        keys.add(row.key);
        if (row.createdAt && (!lastCreatedAt || row.createdAt > lastCreatedAt)) lastCreatedAt = row.createdAt;
      } catch {
        // a corrupt line never blocks ingest; it is simply not counted
      }
    }
    return { keys, lastCreatedAt };
  } catch {
    return { keys: new Set() };
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!shopifyConfigured()) {
    console.error('shopify_not_configured: set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN');
    process.exit(3);
  }

  const { keys, lastCreatedAt } = await readKeys();
  const orders: PaidOrder[] = await fetchPaidOrders(lastCreatedAt);
  const fresh = orders.filter((o) => !keys.has(orderKey(o)));

  const total = fresh.reduce((sum, o) => sum + o.total, 0);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    fetched: orders.length,
    alreadyRecorded: orders.length - fresh.length,
    newOrders: fresh.length,
    newRevenue: Number(total.toFixed(2)),
    since: lastCreatedAt ?? null,
  }, null, 2));

  if (!apply || fresh.length === 0) return;

  await fs.mkdir(path.dirname(LEDGER), { recursive: true });
  const lines = fresh.map((o) => JSON.stringify({
    ts: new Date().toISOString(),
    key: orderKey(o),
    name: o.name,
    total: o.total,
    currency: o.currency,
    email: o.email,
    createdAt: o.createdAt,
  }));
  await fs.appendFile(LEDGER, `${lines.join('\n')}\n`, 'utf8');
  console.log(`appended ${fresh.length} order(s) to ${path.relative(process.cwd(), LEDGER)}`);
}

main().catch((error) => {
  console.error('FAIL-CLOSED:', (error as Error).message);
  process.exit(1);
});
