import { NextResponse } from 'next/server';
import { configuredHostedRails } from '@/lib/checkout-rails';

/**
 * GET /api/checkout/rails
 *
 * Readiness report for the card-collection rails. Booleans and product counts
 * only — no keys, no checkout URLs.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    hosted: configuredHostedRails(),
    entityJurisdiction: process.env.BUSINESS_JURISDICTION || 'unset',
    note: 'Card rail order: Stripe when configured, then hosted Merchant-of-Record links by course slug.',
  });
}
