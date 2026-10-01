import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Course-order ledger for RealWorldCerts card checkout.
 *
 * Append-only ndjson at data/out/course-orders.ndjson (same pattern as the
 * security-gate/ratelimit spillover files). No DB migration needed; swap for a
 * Prisma model later if volume justifies it. File writes are best-effort —
 * a failed append never fails the webhook response to Stripe.
 */

export interface CourseOrder {
  ts: string;
  event_id: string;
  session_id: string;
  email: string;
  slug: string;
  title: string;
  amount_total: number;
  currency: string;
  status: string;
  delivery: 'SENT' | 'PENDING' | string;
  delivery_detail: string;
}

function ledgerPath(): string {
  return path.join(process.cwd(), 'data', 'out', 'course-orders.ndjson');
}

export async function appendOrder(order: CourseOrder): Promise<void> {
  try {
    const p = ledgerPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, JSON.stringify(order) + '\n', 'utf8');
  } catch (err) {
    console.error('[rwc-order-ledger] append failed', err);
  }
}

export async function readOrders(limit = 100): Promise<CourseOrder[]> {
  try {
    const raw = await fs.readFile(ledgerPath(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l) as CourseOrder; } catch { return null; }
    }).filter((x): x is CourseOrder => x !== null);
  } catch {
    return [];
  }
}

export async function findOrderBySession(sessionId: string): Promise<CourseOrder | null> {
  const orders = await readOrders(500);
  return orders.find((o) => o.session_id === sessionId) ?? null;
}
