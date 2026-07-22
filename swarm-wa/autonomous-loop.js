const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = path.join(__dirname, '..');
const LOG_DIR = path.join(__dirname, 'logs');
const REPLY_LOG = path.join(LOG_DIR, 'reply-log.json');
const SEND_LOG = path.join(LOG_DIR, 'send-log.json');
const ACTIVITY_LOG = path.join(LOG_DIR, 'activity-log.json');
const VENDOR_DB = path.join(BASE, 'exports', 'procurement-requests', 'vendor-database.json');
const BATCH_DIR = path.join(BASE, 'exports', 'procurement-requests');
const PO_DIR = path.join(BASE, 'exports', 'purchase-orders');
const PROCESSING_LOG = path.join(LOG_DIR, 'processed-replies.json');
const STATE_FILE = path.join(LOG_DIR, 'loop-state.json');

const POLL_INTERVAL = 15000;
const SEND_DELAY = 3000;

let state = { lastReplyIdx: 0, processedIds: new Set(), sentCount: 0 };
let sendQueue = [];

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function saveJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function log(tag, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${msg}`;
  console.log(line);
  let activity = [];
  try { activity = JSON.parse(fs.readFileSync(ACTIVITY_LOG, 'utf8')); } catch {}
  activity.push({ timestamp: ts, tag, message: msg });
  if (activity.length > 500) activity = activity.slice(-500);
  saveJson(ACTIVITY_LOG, activity);
}

function getVendorByPhone(phone) {
  const db = loadJson(VENDOR_DB);
  if (!db) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  for (const category of Object.values(db.vendors)) {
    for (const v of category) {
      const vDigits = (v.phone || '').replace('+', '');
      const wDigits = (v.whatsapp || '').replace('+', '');
      if (vDigits && digits.endsWith(vDigits)) return v;
      if (wDigits && digits.endsWith(wDigits)) return v;
    }
  }
  return null;
}

function getVendorByMessage(body) {
  const db = loadJson(VENDOR_DB);
  if (!db) return null;
  const lower = body.toLowerCase();
  for (const category of Object.values(db.vendors)) {
    for (const v of category) {
      const names = [v.name, v.tiktok, v.location].filter(Boolean).map(n => n.toLowerCase());
      if (names.some(n => lower.includes(n))) return v;
    }
  }
  return null;
}

function getBatchItems(batchId) {
  const p = path.join(BATCH_DIR, `batch-${batchId}-procurement.json`);
  if (!fs.existsSync(p)) return null;
  return loadJson(p);
}

function analyzeReply(body, vendor) {
  const lower = body.toLowerCase().trim();
  if (/\b(ok|oui|نعم|اه|ايه|sir|yallah|yep|yes)\b/i.test(lower)) return 'affirmative';
  if (/\b(non|لا|ماشي|no|nah)\b/i.test(lower)) return 'negative';
  if (/\d+\s*(dh|dhs|mad|درهم|\$|usd|eur)/i.test(lower) || /\d{2,}/.test(lower)) return 'price_quote';
  if (/\?|واش|شحال|كم|comment|how/i.test(lower)) return 'question';
  if (/merci|شكرا|thanks|thank/i.test(lower)) return 'thanks';
  if (lower.length < 3) return 'short_ack';
  return 'general';
}

function extractPrices(body) {
  const prices = [];
  const matches = body.match(/(\d[\d\s.,]*)\s*(dh|dhs|mad|درهم|\$|usd|eur)?/gi);
  if (matches) {
    for (const m of matches) {
      const num = parseFloat(m.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (num > 0 && num < 1000000) prices.push(num);
    }
  }
  return prices;
}

function generatePO(vendor, body, batchId) {
  if (!fs.existsSync(PO_DIR)) fs.mkdirSync(PO_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const poId = `PO-${batchId}-${vendor.id || 'UNK'}-${Date.now()}`;
  const prices = extractPrices(body);

  const batchFile = path.join(BATCH_DIR, `batch-${batchId}-procurement.json`);
  let items = [];
  if (fs.existsSync(batchFile)) {
    const batch = loadJson(batchFile);
    if (batch?.items) items = batch.items;
    else if (Array.isArray(batch)) items = batch;
  }

  const po = {
    po_id: poId,
    batch_id: batchId,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      tiktok: vendor.tiktok,
      phone: vendor.phone || vendor.whatsapp,
    },
    created_at: new Date().toISOString(),
    status: 'pending_review',
    items: items.map((item, i) => ({
      name: item.name || item.description || `Item ${i + 1}`,
      qty: item.quantity || item.qty || 1,
      unit_price: prices[i] || prices[0] || null,
      currency: body.includes('$') || body.toLowerCase().includes('usd') ? 'USD' : 'MAD',
    })),
    raw_message: body.substring(0, 500),
    total_prices_found: prices.length,
  };

  const poFile = path.join(PO_DIR, `${poId}.json`);
  saveJson(poFile, po);
  log('PO', `📄 Generated PO: ${poId} for ${vendor.name} (batch ${batchId}) — ${prices.length} prices found`);

  return po;
}

function generateFollowUp(analysis, body, vendor) {
  if (analysis === 'price_quote') {
    return `شكرا على الأسعار ${vendor.name} 🙏\n\nواش ممكن تأكد ليا:\n1. التوفر (متوفر دابا؟)\n2. مدة التوصيل\n3. طريقة الدفع (CCP / تحويل بنكي / عند التوصيل)\n\nمهم: التوصيل لوت. ريطا، بوزنيقة`;
  }
  if (analysis === 'question') {
    return `أهلا ${vendor.name}!\n\nنعم، أنا كنبحث لعميل ديالي.\nالتوصيل: لوت. ريطا، بوزنيقة\nالميزانية محددة حسب المنتج\n\nعندك أسعار؟ أرسليها ليا 🙏`;
  }
  if (analysis === 'affirmative') {
    return `ممتاز ${vendor.name}! 🙏\n\nواش عندك الأسعار بالجملة؟ أرسلي لائحة الأسعار مع التوفر والمواصفات.\n\nشكرا!`;
  }
  if (analysis === 'thanks') {
    return `العفو ${vendor.name}! أي سؤال أنا هنا 🙏`;
  }
  if (analysis === 'negative') {
    return `شكرا على الإجابة ${vendor.name}. واش عندك منتجات مشابهة؟ أو تقدر ترشح ليا شي حد؟ 🙏`;
  }
  return null;
}

function sendViaApi(phone, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ phone, message });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/send-message', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function processReply(idx, reply) {
  if (state.processedIds.has(reply.timestamp + reply.from)) return false;
  state.processedIds.add(reply.timestamp + reply.from);

  if (reply.type !== 'chat' || !reply.body) return false;

  let vendor = getVendorByPhone(reply.from);
  if (!vendor) vendor = getVendorByMessage(reply.body);
  const who = vendor ? `${vendor.name} (${vendor.tiktok || 'unknown'})` : reply.from;
  const direction = reply.body.startsWith('OUT:') ? 'sent' : 'received';

  if (direction === 'sent') return false;

  log('REPLY', `📩 ${who}: "${reply.body.substring(0, 150)}"`);

  if (!vendor) {
    log('REPLY', `  ⚠️ Unknown vendor — notifying owner`);
    try {
      await sendViaApi('+212639158209', `⚠️ Unknown vendor reply from ${reply.from}:\n\n"${reply.body.substring(0, 200)}"\n\n Reply ID: ${reply.from}`);
    } catch {}
    return true;
  }

  const analysis = analyzeReply(reply.body, vendor);
  log('REPLY', `  📊 Analysis: ${analysis}`);

  // Auto-generate PO on price quotes
  if (analysis === 'price_quote') {
    const batchIds = vendor.batches || [];
    for (const bid of batchIds) {
      const po = generatePO(vendor, reply.body, bid);
      try {
        await sendViaApi('+212639158209', `📄 Auto-PO generated!\n\nVendor: ${vendor.name}\nBatch: ${bid}\nPO: ${po.po_id}\nPrices found: ${po.total_prices_found}\n\n→ Review: exports/purchase-orders/${po.po_id}.json`);
      } catch {}
    }
  }

  const followUp = generateFollowUp(analysis, reply.body, vendor);
  if (!followUp) {
    log('REPLY', `  ℹ️ No follow-up needed for: ${analysis}`);
    return true;
  }

  log('REPLY', `  📤 Queueing follow-up to ${vendor.name}...`);

  sendQueue.push({
    phone: vendor.whatsapp || vendor.phone,
    message: followUp,
    vendorName: vendor.name,
    analysis,
    queuedAt: new Date().toISOString(),
    retries: 0,
    maxRetries: 3,
  });

  return true;
}

async function processQueue() {
  if (sendQueue.length === 0) return;

  const next = sendQueue.shift();
  const phone = next.phone.startsWith('+') ? next.phone : `+${next.phone}`;

  try {
    const result = await sendViaApi(phone, next.message);
    if (result.success) {
      log('SEND', `✅ Sent follow-up to ${next.vendorName} (${phone}) — triggered by: ${next.analysis}`);
      state.sentCount++;
    } else {
      throw new Error(result.error || 'Send failed');
    }
  } catch (e) {
    next.retries = (next.retries || 0) + 1;
    if (next.retries < (next.maxRetries || 3)) {
      const backoff = [5000, 15000, 30000][next.retries - 1] || 30000;
      log('SEND', `⚠️ Retry ${next.retries}/${next.maxRetries} for ${next.vendorName} in ${backoff/1000}s: ${e.message}`);
      setTimeout(() => { sendQueue.push(next); }, backoff);
    } else {
      log('SEND', `❌ Failed ${next.vendorName} after ${next.maxRetries} retries: ${e.message}`);
      try {
        await sendViaApi('+212639158209', `❌ Failed to send follow-up to ${next.vendorName} (${phone}) after ${next.maxRetries} retries.\nLast error: ${e.message}`);
      } catch {}
    }
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000/health', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const h = JSON.parse(d);
          resolve(h.status === 'ready');
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

async function pollLoop() {
  const healthy = await checkHealth();
  if (!healthy) {
    log('HEALTH', '⚠️ WhatsApp server not ready — waiting...');
    return;
  }

  const replies = loadJson(REPLY_LOG) || [];
  const newReplies = replies.slice(state.lastReplyIdx);
  state.lastReplyIdx = replies.length;

  let processed = 0;
  for (const reply of newReplies) {
    const didProcess = await processReply(state.lastReplyIdx - newReplies.length + newReplies.indexOf(reply), reply);
    if (didProcess) processed++;
  }

  if (processed > 0) {
    log('LOOP', `📊 Processed ${processed} new replies — queue: ${sendQueue.length} — sent total: ${state.sentCount}`);
  }

  while (sendQueue.length > 0) {
    await processQueue();
    await new Promise(r => setTimeout(r, SEND_DELAY));
  }
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state.lastReplyIdx = s.lastReplyIdx || 0;
    state.sentCount = s.sentCount || 0;
    state.processedIds = new Set(s.processedIds || []);
  } catch {}
}

function saveState() {
  saveJson(STATE_FILE, {
    lastReplyIdx: state.lastReplyIdx,
    sentCount: state.sentCount,
    processedIds: [...state.processedIds].slice(-200),
    lastUpdate: new Date().toISOString()
  });
}

let lastStatsDate = null;

async function sendDailyStats() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastStatsDate === today) return;
  lastStatsDate = today;

  const replies = loadJson(REPLY_LOG) || [];
  const todayReplies = replies.filter(r => r.timestamp && r.timestamp.startsWith(today));
  const vendors = new Set(todayReplies.filter(r => r.from && !r.body?.startsWith('OUT:')).map(r => r.from));

  const stats = [
    `📊 Daily Reply Stats — ${today}`,
    ``,
    `Total replies today: ${todayReplies.length}`,
    `Unique contacts: ${vendors.size}`,
    `Follow-ups sent: ${state.sentCount}`,
    `Queue depth: ${sendQueue.length}`,
    ``,
    `Reply loop: running ✅`,
  ].join('\n');

  try {
    await sendViaApi('+212639158209', stats);
    log('STATS', `Daily stats sent`);
  } catch {}
}

async function main() {
  log('LOOP', '🚀 Autonomous reply processor started');
  log('LOOP', `   Polling every ${POLL_INTERVAL / 1000}s`);
  log('LOOP', `   Send delay: ${SEND_DELAY / 1000}s between messages`);

  loadState();

  const replies = loadJson(REPLY_LOG) || [];
  log('LOOP', `   Current replies in log: ${replies.length} (starting from idx ${state.lastReplyIdx})`);

  while (true) {
    try {
      await pollLoop();
      await sendDailyStats();
      saveState();
    } catch (e) {
      log('ERROR', `Loop error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
