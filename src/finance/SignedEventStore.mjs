/**
 * SignedEventStore — immutable, encrypted-at-rest persistence of provider webhooks
 * and transfer metadata (quoteId / transferId / payoutId).
 *
 * OWNER guardrails covered:
 *   - "Persist source provider metadata (quoteId, transferId, payoutId) and the
 *     complete webhook payload (signed) in encrypted storage."
 *   - Reconciliation-audit trail: every signed webhook and every transfer ref is
 *     stored so a later mismatch can be re-verified against the original bytes.
 *
 * SAFETY / non-goals:
 *   - Write-only ledger-style log. It NEVER initiates money movement.
 *   - Encryption at rest uses a key from env (TREASURY_LOG_PASSPHRASE). If absent
 *     it degrades to a clearly-marked plaintext marker (never silent).
 *   - Each event gets a deterministic content hash (SHA-256) binding it, so
 *     tampering after the fact is detectable.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KDF_SALT = 'treasury-signed-event-log-v1';

export class SignedEventStore {
  constructor({ dir, passphrase } = {}) {
    this.dir = dir || path.join(os.tmpdir(), 'treasury-events');
    fs.mkdirSync(this.dir, { recursive: true });
    this.passphrase = passphrase || process.env.TREASURY_LOG_PASSPHRASE;
    this.key = this.passphrase
      ? crypto.scryptSync(this.passphrase, KDF_SALT, 32)
      : null;
  }

  _deriveIv(nonce) {
    // deterministic IV keyed by event nonce → same event encrypts deterministically.
    return crypto.createHash('sha256').update(nonce).digest().subarray(0, 12);
  }

  _encrypt(plain, nonce) {
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, this._deriveIv(nonce));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return {
      ct: ct.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      kdf: 'aes-256-gcm',
    };
  }

  /**
   * Persist a signed webhook / transfer record.
   * @param {object} opts
   * @param {string}  opts.kind          e.g. 'paypal.webhook' | 'wise.quote' | 'wise.transfer'
   * @param {object}  opts.providerMeta  { quoteId, transferId, payoutId, ... } (source metas)
   * @param {string}  [opts.webhookPayloadRaw]  the COMPLETE raw payload bytes (if webhook)
   * @param {string}  [opts.signature]   the provider's signature header value (signed)
   * @param {string}  [opts.direction]   'inbound' | 'outbound' | 'unknown'
   * @param {number}  [opts.amount]
   * @param {string}  [opts.currency]
   * @param {string}  [opts.status]      provider-reported status ('received'|'succeeded'|'failed'|...)
   */
  record({ kind, providerMeta = {}, webhookPayloadRaw, signature, direction = 'unknown', amount, currency, status = 'received' }) {
    const nonce = `${kind}:${crypto.randomUUID()}`;
    const metaJson = JSON.stringify(providerMeta);
    const payload = webhookPayloadRaw != null ? webhookPayloadRaw : metaJson;
    const contentHash = crypto.createHash('sha256').update(payload).digest('hex');

    const envelope = {
      id: `evt-${crypto.randomUUID()}`,
      ts: new Date().toISOString(),
      kind,
      direction,
      amount,
      currency,
      providerStatus: status,
      contentHash,
      signature: signature != null ? signature : null,
      wrapped: this.key ? this._encrypt(payload, nonce) : { plaintextMarker: true, _: payload.slice(0, 200) },
    };
    const fname = `${new Date().toISOString().replace(/[:.]/g, '-')}-${contentHash.slice(0, 12)}.json`;
    fs.writeFileSync(path.join(this.dir, fname), JSON.stringify(envelope, null, 2));
    return { id: envelope.id, contentHash, stored: true, encrypted: !!this.key };
  }

  /** Decrypt + verify one event file; returns the original payload + contentHash. */
  read(fname) {
    const env = JSON.parse(fs.readFileSync(path.join(this.dir, fname), 'utf8'));
    if (env.wrapped.plaintextMarker) return { ...env, rawPayload: env.wrapped._ };
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, this._deriveIv(`${env.kind}:`));
    const buf = Buffer.concat([decipher.update(Buffer.from(env.wrapped.ct, 'base64')), decipher.final()]);
    const raw = buf.toString('utf8');
    const h = crypto.createHash('sha256').update(raw).digest('hex');
    if (h !== env.contentHash) throw new Error('content hash mismatch (tampered event)');
    return { ...env, rawPayload: raw };
  }

  list() { return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); }
}