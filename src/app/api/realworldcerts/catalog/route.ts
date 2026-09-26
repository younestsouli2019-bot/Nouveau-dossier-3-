import { NextResponse } from 'next/server';
import { getCatalogData } from './data-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { products, summary } = getCatalogData();
  return NextResponse.json({
    status: 'ok',
    updatedAt: new Date().toISOString(),
    source: 'realworldcerts-ai-catalog-2026-08-31',
    summary,
    products,
  });
}
