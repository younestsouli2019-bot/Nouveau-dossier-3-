import { NextRequest, NextResponse } from 'next/server';
import {
  campaignRedirectUrl,
  logRwcEvent,
} from '@/lib/rwc-social';

export const dynamic = 'force-dynamic';

const validEvents = new Set(['view', 'click', 'sale']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('c');
  const evtRaw = (searchParams.get('evt') || 'click').toLowerCase();
  const channel = searchParams.get('utm_source') || searchParams.get('channel');
  const ref = searchParams.get('ref');
  const valueRaw = searchParams.get('value');

  if (!campaignId) {
    return NextResponse.redirect(campaignRedirectUrl(''), 302);
  }

  const event = validEvents.has(evtRaw) ? (evtRaw as 'view' | 'click' | 'sale') : 'click';
  const valueUsd = valueRaw !== null && Number(valueRaw) > 0 ? Number(valueRaw) : null;

  logRwcEvent({
    campaign_id: campaignId,
    channel: channel || 'tiktok',
    event,
    value_usd: valueUsd,
    ref,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
  });

  return NextResponse.redirect(campaignRedirectUrl(campaignId), 302);
}
