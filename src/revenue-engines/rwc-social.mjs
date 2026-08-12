import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RWC_DATA_DIR = process.env.RWC_DATA_DIR || path.join(ROOT, 'data', 'rwc-social');
const DATA_DIR = RWC_DATA_DIR;
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');
const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');
const TRENDS_PATH = path.join(DATA_DIR, 'trends.jsonl');
const CAMPAIGNS_PATH = path.join(DATA_DIR, 'campaigns.jsonl');
const CLICKS_PATH = process.env.RWC_CLICKS_PATH || path.join(DATA_DIR, 'clicks.jsonl');
const CRITIQUE_PATH = path.join(DATA_DIR, 'critique.jsonl');

const SEED_TOPICS = [
  { id: 'secplus-sy0-701', domain: 'CompTIA Security+', title: 'Security+ SY0-701 2026 exam changes', query: 'Security+ SY0-701 2026 exam changes', source: 'seed', angle: 'quiz' },
  { id: 'ceh-vs-pentest', domain: 'CEH', title: 'CEH 13 vs CompTIA PenTest+', query: 'CEH 13 vs CompTIA PenTest+ which to take', source: 'seed', angle: 'career' },
  { id: 'cissp-2026', domain: 'CISSP', title: 'CISSP 2026 objectives update', query: 'CISSP 2026 exam objectives changes', source: 'seed', angle: 'cheat_sheet' },
  { id: 'ccna-v11', domain: 'CCNA', title: 'CCNA 200-301 v1.1', query: 'CCNA 200-301 v1.1 exam topics', source: 'seed', angle: 'quiz' },
  { id: 'cism-proctoring', domain: 'CISM', title: 'CISM remote proctoring tips', query: 'CISM remote proctoring tips 2026', source: 'seed', angle: 'career' },
  { id: 'iso27001-2022', domain: 'ISO 27001', title: 'ISO 27001:2022 control changes', query: 'ISO 27001:2022 Annex A control changes', source: 'seed', angle: 'cheat_sheet' },
  { id: 'cysa-vs-secplus', domain: 'CySA+', title: 'CySA+ vs Security+ career path', query: 'CySA+ vs Security+ which certification', source: 'seed', angle: 'career' },
  { id: 'owasp-api', domain: 'OWASP', title: 'OWASP API security top risks', query: 'OWASP API security top 10 risks', source: 'seed', angle: 'cheat_sheet' },
  { id: 'oscp-report', domain: 'OSCP', title: 'OSCP exam report writing', query: 'OSCP exam report writing guide', source: 'seed', angle: 'cheat_sheet' },
  { id: 'aws-security', domain: 'AWS Security', title: 'AWS Certified Security Specialty guide', query: 'AWS Security Specialty certification guide', source: 'seed', angle: 'quiz' },
];

const QUESTION_BANK = {
  'CompTIA Security+': [
    { question: 'Which control is BEST used to prevent tailgating at a physical entrance?', options: ['CCTV', 'A mantrap', 'A smartcard reader', 'A bollard'], answer: 1, explanation: 'A mantrap forces one person to fully enter before the next door can open.' },
    { question: 'Which of the following is an example of a zero-day exploit?', options: ['A patch released in advance', 'An exploit for an unknown, unpatched vulnerability', 'A brute-force attack', 'A phishing campaign'], answer: 1, explanation: 'A zero-day targets a vulnerability that is unknown to the vendor.' },
  ],
  'CEH': [
    { question: 'During footprinting, which tool queries DNS records for a target?', options: ['nslookup', 'ping', 'traceroute', 'netstat'], answer: 0, explanation: 'nslookup performs DNS lookups for records such as A, MX, and TXT.' },
  ],
  'CISSP': [
    { question: 'Which of the following is a core principle of the CIA triad?', options: ['Reliability', 'Integrity', 'Authenticity', 'Anonymity'], answer: 1, explanation: 'The CIA triad is Confidentiality, Integrity, and Availability.' },
  ],
  'CCNA': [
    { question: 'Which layer of the OSI model does IP operate at?', options: ['Data Link', 'Network', 'Transport', 'Application'], answer: 1, explanation: 'IP is a Layer 3 (Network) protocol that handles addressing and routing.' },
  ],
  'CISM': [
    { question: 'Which process BEST identifies risk owners within an organization?', options: ['Risk assessment', 'Risk treatment', 'Risk acceptance', 'Risk communication'], answer: 0, explanation: 'Risk assessment identifies, analyzes, and evaluates risks and their owners.' },
  ],
  'ISO 27001': [
    { question: 'Which phase of the PDCA cycle do internal audits belong to?', options: ['Plan', 'Do', 'Check', 'Act'], answer: 2, explanation: 'Internal audits verify the system in the Check phase.' },
  ],
  'CySA+': [
    { question: 'Which analysis technique groups alerts by source IP to find patterns?', options: ['Packet capture', 'Netflow analysis', 'Log aggregation', 'Threat intelligence'], answer: 2, explanation: 'Aggregating logs groups related events for pattern detection.' },
  ],
  'OWASP': [
    { question: 'Which OWASP risk is MOST associated with trusting client-side input?', options: ['Broken authentication', 'Injection', 'Sensitive data exposure', 'Insecure design'], answer: 1, explanation: 'Injection occurs when untrusted input is executed as code.' },
  ],
  'OSCP': [
    { question: 'Which phase comes FIRST in the standard penetration testing methodology?', options: ['Exploitation', 'Information gathering', 'Post exploitation', 'Reporting'], answer: 1, explanation: 'Information gathering (recon) always precedes exploitation.' },
  ],
  'AWS Security': [
    { question: 'Which AWS service provides temporary, least-privilege credentials?', options: ['IAM Users', 'IAM Roles', 'Security Groups', 'KMS'], answer: 1, explanation: 'IAM Roles issue short-term credentials for trusted principals.' },
  ],
  'default': [
    { question: 'Which security control is applied to DEFEND against a specific threat?', options: ['Detective', 'Preventive', 'Corrective', 'Compensating'], answer: 1, explanation: 'Preventive controls stop an incident before it happens.' },
  ],
};

const slugify = (s) => String(s || 'topic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  mkdirSync(OUTBOX_DIR, { recursive: true });
}

async function readJsonl(p) {
  if (!existsSync(p)) return [];
  const lines = (await fs.readFile(p, 'utf-8')).split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) { try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ } }
  return out;
}

async function appendJsonl(p, obj) {
  mkdirSync(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + '\n', 'utf-8');
}

async function writeArtifact(name, obj) {
  await ensureDirs();
  const p = path.join(ARTIFACTS_DIR, name);
  await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf-8');
  return p;
}

async function jpost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${String(text).slice(0, 300)}`);
  return data;
}

async function jget(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${String(text).slice(0, 300)}`);
  return data;
}

class RWCSocialEngine extends RevenueEngine {
  constructor() {
    super('rwc-social', {
      version: '0.1.0',
      vendor: 'https://realworldcerts.com',
      description: 'Autonomous agentic swarm for RealWorldCerts YouTube/TikTok: trend scout, content strategist, audio, visual, assembly, publisher, critic',
      requiredEnv: [],
      optionalEnv: [
        'RWC_LLM_URL', 'RWC_LLM_KEY', 'ELEVENLABS_API_KEY', 'RWC_ELEVENLABS_VOICE',
        'REPLICATE_API_KEY', 'SHOTSTACK_API_KEY', 'TIKTOK_ACCESS_TOKEN', 'YOUTUBE_ACCESS_TOKEN',
        'RWC_CATALOG_URL', 'RWC_TRACKING_BASE_URL', 'RWC_COMMISSION_PER_SALE_USD',
        'RWC_PUBLISH_ALLOWED', 'RWC_SOCIAL_MAX_TOPICS', 'RWC_TRENDS_FILE',
      ],
    });
  }

  async _init() {
    await ensureDirs();
    this._maxTopics = parseInt(process.env.RWC_SOCIAL_MAX_TOPICS || '5', 10);
    this._commissionPerSale = Number(process.env.RWC_COMMISSION_PER_SALE_USD || 0);
    this._catalogUrl = process.env.RWC_CATALOG_URL || 'https://realworldcerts.com/course/';
    this._trackingBase = process.env.RWC_TRACKING_BASE_URL || 'https://realworldcerts.com/track';
    this._trendsFile = process.env.RWC_TRENDS_FILE;
    this._ownerLegalName = 'Younes Tsouli';
    this._beneficiary = process.env.OWNER_PAYPAL_EMAIL || '';
    const truthPath = path.join(ROOT, 'owner-truth.json');
    try {
      const truth = JSON.parse(await fs.readFile(truthPath, 'utf-8'));
      this._ownerLegalName = truth?.owner?.legalName || this._ownerLegalName;
      this._beneficiary = truth?.paymentDestinations?.paypal?.email || this._beneficiary;
    } catch { /* fall back to defaults */ }
    this.info(`init ok — owner=${this._ownerLegalName} beneficiary=${this._beneficiary ? 'set' : 'EMPTY'} live=${this.isLive()}`);
  }

  async _scout() {
    const topics = [];
    if (this._trendsFile && existsSync(this._trendsFile)) {
      for (const raw of (await fs.readFile(this._trendsFile, 'utf-8')).split('\n').filter(Boolean)) {
        try {
          const t = JSON.parse(raw);
          if (t?.title && t?.domain) topics.push({ id: t.id || slugify(t.title), domain: t.domain, title: t.title, query: t.query || t.title, source: t.source || 'trend_feed', angle: t.angle || 'quiz', ts: t.ts || Date.now() });
        } catch { /* skip malformed trend */ }
      }
    }
    if (topics.length === 0) {
      for (const t of SEED_TOPICS) topics.push({ ...t, ts: Date.now() });
      await fs.writeFile(TRENDS_PATH, topics.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf-8');
      this.info(`seeded ${topics.length} trend topics`);
    }
    const weights = await this._topicWeights();
    topics.sort((a, b) => (weights[b.id] || 0) - (weights[a.id] || 0));
    return topics;
  }

  async _topicWeights() {
    const weights = {};
    const campaigns = await readJsonl(CAMPAIGNS_PATH);
    const clicks = await readJsonl(CLICKS_PATH);
    for (const c of campaigns) {
      const events = clicks.filter(x => x.campaign_id === c.campaign_id);
      let score = 0;
      for (const e of events) {
        if (e.event === 'sale') score += 100;
        if (e.event === 'click') score += 10;
        if (e.event === 'view') score += 1;
      }
      weights[c.topic_id] = (weights[c.topic_id] || 0) + score;
    }
    return weights;
  }

  _pickQuestion(topic) {
    const bank = QUESTION_BANK[topic.domain] || QUESTION_BANK['default'];
    const seed = crypto.createHash('sha256').update(String(topic.id)).digest();
    const idx = seed[0] % bank.length;
    return bank[idx];
  }

  _buildScript(topic, c, q) {
    const options = q.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    return `${c.hook}\n3... 2... 1...\n${q.question}\n${options}\nANSWER: ${q.options[q.answer]}\n${q.explanation}\n${c.cta}`;
  }

  _buildCaptions(topic, c, q) {
    const segs = [];
    let t = 0;
    const push = (dur, text) => { segs.push({ start: Number(t.toFixed(2)), end: Number((t + dur).toFixed(2)), text }); t += dur; };
    push(2.2, c.hook);
    push(1.2, '3… 2… 1…');
    push(4.0, q.question);
    push(3.0, `ANSWER: ${q.options[q.answer]}`);
    push(3.0, q.explanation);
    push(2.6, c.cta);
    return segs;
  }

  _strategize(topic) {
    const angle = topic.angle || 'quiz';
    const byAngle = {
      quiz: { hook: `Can you pass this ${topic.domain} quiz?`, cta: `Full ${topic.domain} practice: ${this._catalogUrl}` },
      cheat_sheet: { hook: `Top ${topic.domain} concepts in 30 seconds`, cta: `Free ${topic.domain} cheat sheet: ${this._catalogUrl}` },
      career: { hook: `${topic.domain} salary vs cert cost in 2026`, cta: `Start ${topic.domain} prep: ${this._catalogUrl}` },
    };
    const tpl = byAngle[angle] || byAngle.quiz;
    const q = this._pickQuestion(topic);
    return {
      template: angle,
      hook: tpl.hook,
      cta: tpl.cta,
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      hashtags: ['#cybersecurity', '#certification', '#itcareer', `#${slugify(topic.domain)}`],
      script: this._buildScript(topic, tpl, q),
      captions: this._buildCaptions(topic, tpl, q),
      slug: slugify(topic.title),
    };
  }

  async _audio(topic, concept) {
    const spec = {
      engine: 'elevenlabs',
      voice_id: process.env.RWC_ELEVENLABS_VOICE || '21m00Tcm4TlvDq8ikWAM',
      script: concept.script,
      api_url: 'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}',
      dry_run: true,
      audio_path: null,
    };
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (this.isLive() && apiKey) {
      try {
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${spec.voice_id}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ text: spec.script, model_id: process.env.RWC_ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const p = path.join(ARTIFACTS_DIR, `audio-${topic.id}.mp3`);
          await fs.writeFile(p, buf);
          spec.audio_path = p;
          spec.dry_run = false;
          this.info(`audio generated for ${topic.id}`);
        } else {
          spec.error = `TTS ${res.status}`;
          this.warn(`elevenlabs failed: ${res.status}`);
        }
      } catch (e) {
        spec.error = e.message;
        this.warn(`elevenlabs error: ${e.message}`);
      }
    }
    return spec;
  }

  async _visual(topic, concept) {
    const spec = {
      engine: 'replicate-flux',
      prompt: `Vertical 9:16 animated cyber-themed background for a cybersecurity short, theme ${topic.domain}, glowing circuits, no readable text`,
      api_url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      dry_run: true,
      image_path: null,
    };
    const apiKey = process.env.REPLICATE_API_KEY;
    if (this.isLive() && apiKey) {
      try {
        const data = await jpost(spec.api_url, {
          input: {
            prompt: spec.prompt,
            aspect_ratio: '9:16',
            num_outputs: 1,
          },
        }, { Authorization: `Bearer ${apiKey}`, 'Prefer': 'wait' });
        const urls = data?.output || data?.urls?.get;
        if (urls) {
          spec.image_url = Array.isArray(urls) ? urls[0] : urls;
          spec.dry_run = false;
          this.info(`visual generated for ${topic.id}`);
        } else {
          spec.error = 'replicate returned no output';
        }
      } catch (e) {
        spec.error = e.message;
        this.warn(`replicate error: ${e.message}`);
      }
    }
    return spec;
  }

  _assemble(topic, concept, audio, visual, campaignId) {
    const duration = concept.captions.reduce((m, s) => Math.max(m, s.end), 0);
    return {
      engine: 'shotstack',
      duration_seconds: Math.ceil(duration),
      audio,
      visual,
      shots: concept.captions.map((c, i) => ({
        id: `shot-${i + 1}`,
        start: c.start,
        end: c.end,
        text: c.text,
        visual_prompt: visual.prompt,
        voice_id: audio.voice_id,
      })),
      captions: concept.captions,
      render_api: 'https://api.shotstack.io/staging/render',
      render_hint: 'render via Shotstack API when SHOTSTACK_API_KEY is set, else use scripts/render-short.mjs',
    };
  }

  _trackingUrl(campaignId, topic, channel) {
    return `${this._trackingBase}?c=${campaignId}&utm_source=${channel}&utm_medium=short_form&utm_campaign=${slugify(topic.title || topic.domain)}`;
  }

  _publishPayload(topic, concept, assembly, campaignId) {
    const tracking = this._trackingUrl(campaignId, topic, 'tiktok');
    return {
      campaign_id: campaignId,
      topic_id: topic.id,
      brand: 'RealWorldCerts',
      owner: this._ownerLegalName,
      beneficiary: this._beneficiary,
      platforms: ['tiktok', 'youtube'],
      short_form: {
        duration_seconds: assembly.duration_seconds,
        title: concept.hook,
        description: `${concept.hook}\n\n${concept.cta}\n\n${concept.hashtags.join(' ')}`,
        hashtags: concept.hashtags,
        tracking_url: tracking,
        on_screen: concept.captions,
        asset_refs: { audio: assembly.audio.audio_path || assembly.audio.dry_run, visual: assembly.visual.image_url || assembly.visual.dry_run },
      },
      youtube: {
        title: concept.hook,
        description: `${concept.cta}\n\nTrackable link: ${tracking}\n\n${concept.hashtags.join(' ')}`,
        tags: concept.hashtags,
        category_id: '27',
        privacy_status: 'unlisted',
      },
      tiktok: {
        description: `${concept.hook}\n\n${concept.hashtags.join(' ')}\n\n${tracking}`,
        privacy_level: 'SELF_ONLY',
      },
      status: 'dry_run',
      created_at: new Date().toISOString(),
    };
  }

  async _publishTikTok(payload) {
    try {
      const data = await jpost('https://open.tiktokapis.com/v2/post/publish/creator_info/post/', {
        post_info: { title: payload.tiktok.description, privacy_level: payload.tiktok.privacy_level, disable_duet: false, disable_comment: false, disable_stitch: false },
        source_info: { source: 'PULL_FROM_URL', video_url: payload.short_form.video_url || '', photo_cover_index: 0, video_cover_index: 0 },
      }, { 'access-token': process.env.TIKTOK_ACCESS_TOKEN });
      return { channel: 'tiktok', ok: true, data };
    } catch (e) {
      return { channel: 'tiktok', ok: false, error: e.message };
    }
  }

  async _publishYouTube(payload) {
    try {
      const data = await jpost('https://www.googleapis.com/youtube/v3/videos?part=snippet,status', {
        snippet: { title: payload.youtube.title, description: payload.youtube.description, tags: payload.youtube.tags, categoryId: payload.youtube.category_id },
        status: { privacyStatus: payload.youtube.privacy_status, selfDeclaredMadeForKids: false },
      }, { Authorization: `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}` });
      return { channel: 'youtube', ok: true, data };
    } catch (e) {
      return { channel: 'youtube', ok: false, error: e.message };
    }
  }

  async _publish(topic, payload) {
    const outboxPath = path.join(OUTBOX_DIR, `publish-${payload.campaign_id}.json`);
    await fs.writeFile(outboxPath, JSON.stringify(payload, null, 2), 'utf-8');
    const allowed = String(process.env.RWC_PUBLISH_ALLOWED || '').toLowerCase() === 'true';
    if (!this.isLive() || !allowed) return false;
    const results = [];
    if (process.env.TIKTOK_ACCESS_TOKEN) results.push(await this._publishTikTok(payload));
    if (process.env.YOUTUBE_ACCESS_TOKEN) results.push(await this._publishYouTube(payload));
    if (results.length === 0) return false;
    payload.status = results.some(r => r.ok) ? 'published' : 'failed';
    payload.results = results;
    await fs.writeFile(outboxPath, JSON.stringify(payload, null, 2), 'utf-8');
    return payload.status === 'published';
  }

  async _produceCampaign(topic) {
    const campaignId = `RWC_${Date.now().toString(36).toUpperCase()}_${topic.id}`;
    const concept = this._strategize(topic);
    const audio = await this._audio(topic, concept);
    const visual = await this._visual(topic, concept);
    const assembly = this._assemble(topic, concept, audio, visual, campaignId);
    const payload = this._publishPayload(topic, concept, assembly, campaignId);
    const published = await this._publish(topic, payload);
    const artifact = {
      campaign_id: campaignId,
      topic,
      concept,
      audio,
      visual,
      assembly,
      payload,
      published,
      created_at: new Date().toISOString(),
    };
    await writeArtifact(`campaign-${campaignId}.json`, artifact);
    await appendJsonl(CAMPAIGNS_PATH, {
      campaign_id: campaignId,
      topic_id: topic.id,
      domain: topic.domain,
      angle: concept.template,
      published,
      created_at: artifact.created_at,
    });
    return artifact;
  }

  async _critique() {
    const clicks = await readJsonl(CLICKS_PATH);
    const campaigns = await readJsonl(CAMPAIGNS_PATH);
    const byCampaign = {};
    for (const c of clicks) {
      const agg = (byCampaign[c.campaign_id] ||= { views: 0, clicks: 0, sales: 0, value: 0 });
      if (c.event === 'view' || c.event === 'click' || c.event === 'sale') agg[c.event] += 1;
      if (c.value_usd) agg.value += Number(c.value_usd);
    }
    let sales = 0;
    let earned = 0;
    for (const [cid, agg] of Object.entries(byCampaign)) {
      if (agg.sales > 0) {
        sales += agg.sales;
        earned += agg.value || agg.sales * this._commissionPerSale;
        for (const sale of clicks.filter(c => c.campaign_id === cid && c.event === 'sale')) {
          const earningId = `RWC_SALE_${sale.click_id}`;
          const amount = Number(sale.value_usd || this._commissionPerSale);
          if (!(amount > 0)) continue;
          try {
            await this.emitEarning({
              earningId,
              amount,
              currency: 'USD',
              source: this.name,
              beneficiary: this._beneficiary,
              metadata: {
                campaign_id: cid,
                topic_id: sale.topic_id,
                channel: sale.channel,
                click_id: sale.click_id,
                beneficiary_guard: 'owner-only',
              },
            });
          } catch (e) {
            this.warn(`critique earning failed for ${earningId}: ${e.message}`);
          }
        }
      }
    }
    const totals = { views: 0, clicks: 0, sales, earned };
    for (const agg of Object.values(byCampaign)) {
      totals.views += agg.views;
      totals.clicks += agg.clicks;
    }
    totals.ctr = totals.views > 0 ? Number((totals.clicks / totals.views).toFixed(4)) : 0;
    const critique = {
      generated_at: new Date().toISOString(),
      campaigns_tracked: Object.keys(byCampaign).length,
      campaigns_seen: campaigns.length,
      totals,
      by_campaign: byCampaign,
    };
    await fs.writeFile(CRITIQUE_PATH, JSON.stringify(critique, null, 2), 'utf-8');
    return critique;
  }

  async run() {
    const result = {
      engine: this.name,
      version: this.version,
      run_id: this._runId,
      mode: this._mode,
      started_at: new Date().toISOString(),
      trends: 0,
      campaigns: 0,
      published: 0,
      drafts: 0,
      sales: 0,
      earned: 0,
      errors: [],
    };
    try {
      await this.init();
      if (!this._envOk) {
        result.errors.push({ stage: 'init', error: 'env check failed' });
        result.status = 'env_missing';
        result.ended_at = new Date().toISOString();
        return result;
      }
      await ensureDirs();
      const topics = await this._scout();
      result.trends = topics.length;
      this.info(`trend scout returned ${topics.length} topics (max ${this._maxTopics})`);
      for (const topic of topics.slice(0, this._maxTopics)) {
        try {
          const campaign = await this._produceCampaign(topic);
          result.campaigns += 1;
          if (campaign.published) result.published += 1;
          else result.drafts += 1;
          this.info(`campaign ${campaign.campaign_id} (${topic.domain}) published=${campaign.published}`);
        } catch (e) {
          this.warn(`campaign failed for ${topic.id}: ${e.message}`);
          result.errors.push({ stage: 'produce', topic: topic.id, error: e.message });
        }
      }
      const critique = await this._critique();
      result.sales = critique.totals.sales;
      result.earned = Number(critique.totals.earned.toFixed(2));
      result.ctr = critique.totals.ctr;
      result.status = result.errors.length === 0 ? 'ok' : 'partial';
    } catch (e) {
      result.status = 'fatal';
      result.errors.push({ stage: 'run', error: e.message, stack: e.stack });
      this.error(`fatal: ${e.message}`);
    }
    result.ended_at = new Date().toISOString();
    return result;
  }

  async _status() {
    return {
      agents: {
        trend_scout: { ok: true, reason: `${await this._scout().then(t => t.length)} topics in feed` },
        content_strategist: { ok: true, reason: 'quiz / cheat-sheet / career templates' },
        asset_audio: { ok: true, reason: process.env.ELEVENLABS_API_KEY ? 'elevenlabs ready' : 'dry-run specs only' },
        asset_visual: { ok: true, reason: process.env.REPLICATE_API_KEY ? 'replicate-flux ready' : 'dry-run specs only' },
        video_assembly: { ok: true, reason: 'shotstack manifest + captions' },
        campaign_publisher: { ok: true, reason: this.isLive() && String(process.env.RWC_PUBLISH_ALLOWED || '').toLowerCase() === 'true' ? 'live publish enabled' : 'dry-run outbox only' },
        performance_critic: { ok: true, reason: 'clicks.jsonl → CTR + attributed sales' },
      },
      owner: this._ownerLegalName,
      beneficiary: this._beneficiary ? 'owner-only' : 'UNSET',
      config: {
        live: this.isLive(),
        publish_allowed: String(process.env.RWC_PUBLISH_ALLOWED || '').toLowerCase() === 'true',
        max_topics: this._maxTopics,
        commission_per_sale_usd: this._commissionPerSale,
        catalog_url: this._catalogUrl,
        elevenlabs_configured: !!process.env.ELEVENLABS_API_KEY,
        replicate_configured: !!process.env.REPLICATE_API_KEY,
        shotstack_configured: !!process.env.SHOTSTACK_API_KEY,
        tiktok_configured: !!process.env.TIKTOK_ACCESS_TOKEN,
        youtube_configured: !!process.env.YOUTUBE_ACCESS_TOKEN,
      },
    };
  }
}

register('rwc-social', () => new RWCSocialEngine(), {
  vendor: 'https://realworldcerts.com',
  revenue_model: 'short-form traffic → course sales commission (owner-only beneficiary)',
  integration_cost: 'medium',
  risk_level: 'low',
  recommended_mode: 'observe',
  agents: ['trend_scout', 'content_strategist', 'asset_audio', 'asset_visual', 'video_assembly', 'campaign_publisher', 'performance_critic'],
});

export default RWCSocialEngine;
