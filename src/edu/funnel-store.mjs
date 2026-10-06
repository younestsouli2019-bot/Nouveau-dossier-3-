#!/usr/bin/env node
// S2-T01: FunnelStore — 8 literal stages, single-append HMAC-chain NDJSON.
// Stages (literal enum — no strings outside this list accepted):
//   catalog_view | course_page_view | checkout_start | payment_attempt | verified_payment | successful_delivery | refund | abandoned_order
// Salt: sha256("FUNNEL_EVENT_CHAIN_V1")
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STAGES = Object.freeze([
  "catalog_view",
  "course_page_view",
  "checkout_start",
  "payment_attempt",
  "verified_payment",
  "successful_delivery",
  "refund",
  "abandoned_order",
]);
const STAGE_SET = new Set(STAGES);
const SALT_HEX = crypto.createHash("sha256").update("FUNNEL_EVENT_CHAIN_V1").digest("hex");
function chainKey() {
  return crypto.createHash("sha256").update("HKDF|funnel-store|" + SALT_HEX).digest();
}
function sha256Hex(s){ return crypto.createHash("sha256").update(s).digest("hex"); }
function hmacSha256(k,s){ return crypto.createHmac("sha256",k).update(s).digest("hex"); }
function sortedReplacer(_k,v){ if(v && typeof v==="object" && !Array.isArray(v)){ const o={}; for(const k of Object.keys(v).sort()) o[k]=v[k]; return o;} if(Array.isArray(v)) return v.map((x,i)=>sortedReplacer(String(i),x)); return v; }
function sortedStringify(o){ return JSON.stringify(sortedReplacer("", o)); }
const GENESIS_PREV = sha256Hex("funnel-genesis-v1|" + SALT_HEX);

function uuidV4() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}`;
}

function lock(pathDir) {
  const lockDir = path.join(pathDir, ".funnel-lock");
  try { fs.mkdirSync(lockDir, { recursive: true }); } catch {}
  const lockFile = path.join(lockDir, "funnel.lock");
  for (let i=0;i<20;i++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lockFile); } catch {} };
    } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
  }
  throw new Error("FUNNEL_LOCK_TIMEOUT");
}

export const DEFAULT_FUNNEL_PATH = path.resolve("data/out/funnel-events.ndjson");

export class FunnelStore {
  constructor(opts = {}) {
    this.filePath = opts.filePath || DEFAULT_FUNNEL_PATH;
    this.chainKey = opts.chainKey || chainKey();
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "");
  }

  assertStage(stage) {
    if (!STAGE_SET.has(stage)) {
      throw new Error(`FUNNEL_INVALID_STAGE: ${stage} — must be one of: ${STAGES.join(", ")}`);
    }
  }

  lastLine() {
    const c = fs.readFileSync(this.filePath, "utf8").trim();
    if (!c) return null;
    const lines = c.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]); } catch {}
    }
    return null;
  }

  track(stage, payload = {}) {
    this.assertStage(stage);
    const dir = path.dirname(this.filePath);
    const release = lock(dir);
    try {
      let last = this.lastLine();
      if (!last) {
        const genesisEvent = {
          schema: "funnel-event-v1", id: crypto.randomBytes(16).toString("hex"),
          type: "funnel_genesis", ts: new Date().toISOString(),
          payload: { created_at: new Date().toISOString() }
        };
        const prevH = GENESIS_PREV;
        const evStr = sortedStringify(genesisEvent);
        const hash = sha256Hex(prevH + "|" + evStr);
        const sig = hmacSha256(this.chainKey, hash);
        const line0 = { event: genesisEvent, prevHash: prevH, hash, sig };
        const cur = fs.readFileSync(this.filePath, "utf8");
        const sep = cur.length > 0 && !cur.endsWith("\n") ? "\n" : "";
        fs.appendFileSync(this.filePath, sep + JSON.stringify(line0) + "\n");
        last = line0;
      }
      const sessionId = payload?.sessionId || uuidV4();
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(sessionId)) {
        throw new Error("FUNNEL_SESSION_ID_NOT_UUID4");
      }
      const event = {
        schema: "funnel-event-v1",
        id: crypto.randomBytes(16).toString("hex"),
        stage,
        session_id: sessionId,
        order_reference: payload?.orderReference || null,
        ts: new Date().toISOString(),
        payload: Object.assign({}, payload, { sessionId: undefined, orderReference: undefined })
      };
      const prevH = last.hash;
      const evStr = sortedStringify(event);
      const hash = sha256Hex(prevH + "|" + evStr);
      const sig = hmacSha256(this.chainKey, hash);
      const newLine = { event, prevHash: prevH, hash, sig };
      const sepB = fs.readFileSync(this.filePath, "utf8").endsWith("\n") ? "" : "\n";
      fs.appendFileSync(this.filePath, sepB + JSON.stringify(newLine) + "\n");
      try { const fd = fs.openSync(this.filePath, "r+"); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}
      return newLine;
    } finally {
      release();
    }
  }

  verify() {
    const c = fs.readFileSync(this.filePath, "utf8").trim();
    if (!c) return { valid: true, lineCount: 0 };
    const lines = c.split(/\r?\n/).filter(l=>l.trim().length>0);
    let prev = null;
    for (let i=0;i<lines.length;i++) {
      let p; try { p = JSON.parse(lines[i]); }
      catch (e) { return { valid:false, badLine:i+1, reason:`Line ${i+1} not JSON` }; }
      if (i===0) {
        if (p.event.type !== "funnel_genesis") return { valid:false, badLine:1, reason:"First line must be funnel_genesis" };
        if (p.prevHash !== GENESIS_PREV) return { valid:false, badLine:1, reason:"Genesis prevHash mismatch" };
      } else {
        if (p.prevHash !== prev) return { valid:false, badLine:i+1, reason:"Chain broken prevHash mismatch" };
      }
      if (p.event.stage) this.assertStage(p.event.stage);
      const evStr = sortedStringify(p.event);
      const hash = sha256Hex(p.prevHash + "|" + evStr);
      if (hash !== p.hash) return { valid:false, badLine:i+1, reason:"Hash mismatch computed!=stored" };
      const sig = hmacSha256(this.chainKey, p.hash);
      if (sig !== p.sig) return { valid:false, badLine:i+1, reason:"Signature HMAC mismatch" };
      prev = p.hash;
    }
    return { valid:true, lineCount: lines.length };
  }

  readAll() {
    const c = fs.readFileSync(this.filePath, "utf8").trim();
    if (!c) return [];
    return c.split(/\r?\n/).filter(l=>l.trim().length>0).map(l => JSON.parse(l));
  }
}

export const FUNNEL_STAGES = STAGES;
if (process.argv[1] && process.argv[1].endsWith("funnel-store.mjs")) {
  const fsLocal = new FunnelStore();
  const r = fsLocal.verify();
  console.log(`[funnel-store] self-check: valid=${r.valid} lines=${r.lineCount}`);
  if (!r.valid) { process.exit(17); }
  process.exit(0);
}
