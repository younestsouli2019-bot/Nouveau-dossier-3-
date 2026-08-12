import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface RwcClickEvent {
  click_id: string;
  campaign_id: string;
  topic_id?: string | null;
  channel?: string | null;
  event: 'view' | 'click' | 'sale';
  value_usd?: number | null;
  ref?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  ts: string;
}

export interface RwcCampaign {
  campaign_id: string;
  topic_id: string;
  domain?: string;
  angle?: string;
  published?: boolean;
  created_at: string;
}

export function rwcDataDir(): string {
  if (process.env.RWC_DATA_DIR) return process.env.RWC_DATA_DIR;
  const cwd = process.cwd();
  const repoCandidate = path.resolve(cwd, '..', '..', 'data', 'rwc-social');
  const localCandidate = path.join(cwd, 'data', 'rwc-social');
  if (fs.existsSync(repoCandidate)) return repoCandidate;
  if (fs.existsSync(localCandidate)) return localCandidate;
  return repoCandidate;
}

export function rwcPaths() {
  const dir = rwcDataDir();
  return {
    dir,
    clicks: process.env.RWC_CLICKS_PATH || path.join(dir, 'clicks.jsonl'),
    campaigns: path.join(dir, 'campaigns.jsonl'),
    trends: path.join(dir, 'trends.jsonl'),
    critique: path.join(dir, 'critique.jsonl'),
    outbox: path.join(dir, 'outbox'),
    artifacts: path.join(dir, 'artifacts'),
  };
}

export function readJsonl(p: string): unknown[] {
  try {
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as unknown[];
  } catch {
    return [];
  }
}

export function appendJsonl(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf-8');
}

export function logRwcEvent(partial: Omit<RwcClickEvent, 'click_id' | 'ts'>): RwcClickEvent {
  const event: RwcClickEvent = {
    ...partial,
    click_id: `RWC_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    ts: new Date().toISOString(),
  };
  appendJsonl(rwcPaths().clicks, event);
  return event;
}

export function catalogBaseUrl(): string {
  return process.env.RWC_CATALOG_URL || 'https://realworldcerts.com/';
}

export function campaignRedirectUrl(campaignId: string, fallback?: string): string {
  const campaigns = readJsonl(rwcPaths().campaigns) as RwcCampaign[];
  const campaign = campaigns.find((c) => c.campaign_id === campaignId);
  const base = catalogBaseUrl();
  if (campaign?.topic_id) {
    const q = encodeURIComponent(campaign.domain || campaign.topic_id);
    return `${base}?utm_campaign=${encodeURIComponent(campaignId)}&q=${q}`;
  }
  return fallback || `${base}?utm_campaign=${encodeURIComponent(campaignId)}`;
}
