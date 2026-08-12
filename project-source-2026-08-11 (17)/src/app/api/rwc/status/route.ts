import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  readJsonl,
  rwcPaths,
} from '@/lib/rwc-social';

export const dynamic = 'force-dynamic';

interface ClickRow {
  event?: string;
  value_usd?: number | null;
  [k: string]: unknown;
}

export async function GET() {
  const paths = rwcPaths();
  const trends = readJsonl(paths.trends);
  const campaigns = readJsonl(paths.campaigns);
  const clicks = readJsonl(paths.clicks) as ClickRow[];
  const critique = readJsonl(paths.critique).slice(-1)[0] || null;
  const mode = process.env.SWARM_LIVE === 'true' ? 'live' : 'observe';

  const outbox: Array<{ name: string; status: string; campaign_id?: string; created_at?: string }> = [];
  try {
    if (fs.existsSync(paths.outbox)) {
      for (const f of fs.readdirSync(paths.outbox).sort().reverse().slice(0, 12)) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(paths.outbox, f), 'utf-8'));
          outbox.push({
            name: f,
            status: raw?.status || 'unknown',
            campaign_id: raw?.campaign_id,
            created_at: raw?.created_at,
          });
        } catch {
          outbox.push({ name: f, status: 'unparsed' });
        }
      }
    }
  } catch {
    /* outbox unavailable */
  }

  const views = clicks.filter((c) => c.event === 'view').length;
  const clickCount = clicks.filter((c) => c.event === 'click').length;
  const sales = clicks.filter((c) => c.event === 'sale').length;
  const earned = clicks
    .filter((c) => c.event === 'sale')
    .reduce((sum, c) => sum + (Number(c.value_usd) || 0), 0);

  return NextResponse.json({
    data_dir: paths.dir,
    mode,
    config: {
      publish_allowed: String(process.env.RWC_PUBLISH_ALLOWED || '').toLowerCase() === 'true',
      catalog_url: process.env.RWC_CATALOG_URL || 'https://realworldcerts.com/',
    },
    summary: {
      trends: trends.length,
      campaigns: campaigns.length,
      published: campaigns.filter((c) => (c as { published?: boolean }).published).length,
      drafts: campaigns.filter((c) => !(c as { published?: boolean }).published).length,
      views,
      clicks: clickCount,
      sales,
      earned,
      ctr: views > 0 ? Number(((clickCount + sales) / views).toFixed(4)) : 0,
    },
    critique,
    recent_campaigns: campaigns.slice(-20).reverse(),
    recent_clicks: clicks.slice(-20).reverse(),
    outbox,
  });
}
