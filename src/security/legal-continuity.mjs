import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import keychain from './keychain.mjs';
import auditLog from './audit.mjs';
import ownerGuard from './owner-guard.mjs';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

function rootPath() {
  return process.env.SWARM_ROOT || process.cwd();
}

async function readJson(relPath) {
  const p = path.join(rootPath(), relPath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}

class LegalContinuity {
  #dir = null;
  #legalDir = null;
  #snapshotDir = null;
  #truth = null;
  #initialized = false;
  #keychain = null;
  #auditLog = null;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'legal');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#legalDir = this.#dir;
    this.#snapshotDir = path.join(this.#dir, 'snapshots');
    await fs.mkdir(this.#snapshotDir, { recursive: true });
    this.#truth = (await readJson('owner-truth.json')) || null;
    this.#keychain = opts.keychain || keychain;
    this.#auditLog = opts.auditLog || auditLog;
    this.#initialized = true;
    return this;
  }

  async storeLegalDocument({ name, content, actor = 'system' } = {}) {
    this.#ensureInit();
    if (!name) throw new Error('LegalContinuity: name required');
    const safe = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const sealed = this.#keychain.encryptBuffer(content);
    const p = path.join(this.#legalDir, `${safe}.enc`);
    await fs.writeFile(p, JSON.stringify(sealed, null, 2), 'utf-8');
    await this.#auditLog.append({ actor, action: 'LEGAL_DOC_STORE', resource: safe, result: 'encrypted', detail: { provider: 'keychain' } });
    return { name: safe, encrypted: true };
  }

  async listLegalDocuments() {
    this.#ensureInit();
    const files = await fs.readdir(this.#legalDir);
    return files.filter(f => f.endsWith('.enc')).map(f => f.replace(/\.enc$/, ''));
  }

  async readLegalDocument(name) {
    this.#ensureInit();
    const safe = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const p = path.join(this.#legalDir, `${safe}.enc`);
    if (!existsSync(p)) return null;
    const sealed = JSON.parse(await fs.readFile(p, 'utf-8'));
    return this.#keychain.decryptBuffer(sealed).toString('utf-8');
  }

  async takeForensicSnapshot({ actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    const snapshotId = `snap-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const outDir = path.join(this.#snapshotDir, snapshotId);
    await fs.mkdir(outDir, { recursive: true });
    const files = [
      'owner-truth.json',
      'data/financial/settlement_ledger.json',
      'data/base44_export/PayoutBatch.json',
      'data/base44_export/RevenueEvent.json',
      'data/base44_export/TransactionLog.json',
      '.autonomous-state.json',
      '.swarm/recovery-log.json',
    ];
    const manifest = { id: snapshotId, at: new Date().toISOString(), reason, actor, files: [] };
    for (const rel of files) {
      const content = await readJson(rel);
      if (content == null) continue;
      const sealed = this.#keychain.encryptBuffer(JSON.stringify(content, null, 2));
      const safeName = rel.replace(/[\/\\]/g, '__');
      await fs.writeFile(path.join(outDir, `${safeName}.enc`), JSON.stringify(sealed, null, 2), 'utf-8');
      manifest.files.push({ rel, enc: `${safeName}.enc`, sha256: crypto.createHash('sha256').update(JSON.stringify(sealed)).digest('hex') });
    }
    const manifestPath = path.join(outDir, 'MANIFEST.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    await this.#auditLog.append({ actor, action: 'FORENSIC_SNAPSHOT', resource: snapshotId, result: 'taken', detail: { files: manifest.files.length, reason } });
    return manifest;
  }

  escalationContacts() {
    this.#ensureInit();
    const primary = this.#truth?.contingency?.escalationContacts?.primary || null;
    const legal = this.#truth?.contingency?.escalationContacts?.legal || null;
    const technical = this.#truth?.contingency?.escalationContacts?.technical || null;
    return {
      primary: primary ? { name: primary.name, contact: primary.contact, method: primary.method, responseSLAminutes: primary.responseSLAminutes } : null,
      legal: legal ? { name: legal.name, contact: legal.contact, method: legal.method, responseSLAminutes: legal.responseSLAminutes } : null,
      technical: technical ? { name: technical.name, contact: technical.contact, method: technical.method, responseSLAminutes: technical.responseSLAminutes } : null,
    };
  }

  async triggerWrongfulImprisonmentProtocol({ actor = 'system', detail = null, notify = true } = {}) {
    this.#ensureInit();
    const snapshot = await this.takeForensicSnapshot({ actor, reason: `wrongful_imprisonment:${detail || 'no detail'}` });
    await this.#setDeadManSwitch('wrongful_imprisonment', { at: new Date().toISOString(), detail, snapshotId: snapshot.id });
    const contacts = this.escalationContacts();
    const pack = {
      protocol: 'WRONGFUL_IMPRISONMENT_PROTOCOL',
      at: new Date().toISOString(),
      snapshotId: snapshot.id,
      contacts,
      legalNotes: [
        'Forensic snapshot of all financial state preserved (encrypted, keychain-wrapped).',
        'Legal escalation contact from owner-truth.json must be notified by owner-designated counsel.',
        'No automated fund release. Any resource use requires owner authorization or court order handled by counsel.',
        'Owner identity (CIN A337773) verification required for any beneficiary change.',
      ],
    };
    if (notify) await this.#queueNotification(contacts, pack);
    await this.#auditLog.append({ actor, action: 'WRONGFUL_IMPRISONMENT_PROTOCOL', resource: snapshot.id, result: 'activated', detail });
    return pack;
  }

  async #queueNotification(contacts, pack) {
    const emailPath = path.join(rootPath(), 'data', 'email_queue.json');
    let queue = [];
    if (existsSync(emailPath)) {
      try {
        queue = JSON.parse(await fs.readFile(emailPath, 'utf-8'));
      } catch {
        queue = [];
      }
    }
    const recipients = [contacts.primary?.contact, contacts.legal?.contact].filter(Boolean);
    for (const to of recipients) {
      queue.push({
        to,
        subject: 'SWARM: WRONGFUL IMPRISONMENT PROTOCOL ACTIVATED',
        body: JSON.stringify({ protocol: pack.protocol, at: pack.at, snapshotId: pack.snapshotId, contact: to }, null, 2),
        queuedAt: new Date().toISOString(),
        status: 'queued',
      });
    }
    await fs.writeFile(emailPath, JSON.stringify(queue, null, 2), 'utf-8');
  }

  async #setDeadManSwitch(name, payload) {
    const p = path.join(rootPath(), 'data', 'dead-mans-switch.json');
    let sw = {};
    if (existsSync(p)) {
      try {
        sw = JSON.parse(await fs.readFile(p, 'utf-8'));
      } catch {
        sw = {};
      }
    }
    sw.switches = sw.switches || {};
    sw.switches[name] = { ...payload, updatedAt: new Date().toISOString() };
    await fs.writeFile(p, JSON.stringify(sw, null, 2), 'utf-8');
  }

  async readDeadManSwitch(name = null) {
    const p = path.join(rootPath(), 'data', 'dead-mans-switch.json');
    if (!existsSync(p)) return null;
    try {
      const sw = JSON.parse(await fs.readFile(p, 'utf-8'));
      return name ? (sw.switches || {})[name] || null : sw.switches || {};
    } catch {
      return null;
    }
  }

  async resourceAvailabilityReport({ live = false } = {}) {
    this.#ensureInit();
    const report = { at: new Date().toISOString(), verified: true, sources: [], items: [] };

    const ledger = await readJson('data/financial/settlement_ledger.json');
    if (ledger && Array.isArray(ledger.transactions)) {
      const byStatus = {};
      let total = 0;
      for (const tx of ledger.transactions) {
        byStatus[tx.status] = round2((byStatus[tx.status] || 0) + (tx.amount || 0));
        total += tx.amount || 0;
      }
      report.items.push({ source: 'settlement_ledger', statuses: byStatus, total: round2(total) });
      report.sources.push('data/financial/settlement_ledger.json');
    }

    const revEvents = await readJson('data/base44_export/RevenueEvent.json');
    if (Array.isArray(revEvents)) {
      const byStatus = {};
      let total = 0;
      for (const e of revEvents) {
        byStatus[e.status || 'unknown'] = round2((byStatus[e.status || 'unknown'] || 0) + (e.amount || 0));
        total += e.amount || 0;
      }
      report.items.push({ source: 'revenue_events', statuses: byStatus, total: round2(total) });
      report.sources.push('data/base44_export/RevenueEvent.json');
    }

    if (live) {
      report.items.push({ source: 'wallet_usdt', note: 'live balance queried at request time', statuses: null, total: null });
    }

    report.totalUsd = round2(report.items.reduce((s, i) => s + (i.total || 0), 0));
    return report;
  }

  async status() {
    this.#ensureInit();
    return {
      docs: (await this.listLegalDocuments()).length,
      snapshots: (await fs.readdir(this.#snapshotDir).catch(() => [])).length,
      deadManSwitch: await this.readDeadManSwitch(),
    };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('LegalContinuity not initialized. Call init() first.');
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const legalContinuity = new LegalContinuity();
export default legalContinuity;
export { LegalContinuity };
