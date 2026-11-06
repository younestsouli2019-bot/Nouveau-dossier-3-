/** Paid-order ingestion. Revenue reporting only — never moves money. */
import { shopifyGraphQL } from './client';

export interface PaidOrder {
  id: string;
  name: string;
  total: number;
  currency: string;
  email: string | null;
  createdAt: string;
}

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  email: string | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } } | null;
}

const ORDERS_QUERY = `#graphql
query PaidOrders($cursor: String, $search: String) {
  orders(first: 50, after: $cursor, query: $search, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      email
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
    }
  }
}`;

export function normalizeOrder(node: OrderNode): PaidOrder | null {
  if (node.displayFinancialStatus !== 'PAID') return null;
  const amount = Number(node.currentTotalPriceSet?.shopMoney?.amount ?? NaN);
  const currency = node.currentTotalPriceSet?.shopMoney?.currencyCode;
  if (!Number.isFinite(amount) || !currency) return null;
  return {
    id: node.id,
    name: node.name,
    total: amount,
    currency,
    email: node.email ?? null,
    createdAt: node.createdAt,
  };
}

export async function fetchPaidOrders(
  sinceIso?: string,
  maxPages = 10,
): Promise<PaidOrder[]> {
  const search = sinceIso ? `financial_status:paid AND created_at:>=${sinceIso}` : 'financial_status:paid';
  const seen: PaidOrder[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] };
    } = await shopifyGraphQL(ORDERS_QUERY, { cursor, search });

    for (const node of data.orders.nodes) {
      const normalized = normalizeOrder(node);
      if (normalized) seen.push(normalized);
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return seen;
}

/** Stable key so a replayed sync cannot double-count revenue. */
export function orderKey(order: PaidOrder): string {
  return `shopify:${order.id}`;
}
