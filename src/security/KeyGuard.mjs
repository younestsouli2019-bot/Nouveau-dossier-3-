import fs from 'node:fs';
import crypto from 'node:crypto';
import '../load-env.mjs';
import { computeConstitutionHashFromFile } from '../bootstrap/constitution-validator.mjs';

function decryptBackup(json, secret) {
  const salt = Buffer.from(String(json.s), 'hex');
  const key = crypto.scryptSync(String(secret), salt, 32);
  const iv = Buffer.from(String(json.iv), 'hex');
  const tag = Buffer.from(String(json.tag), 'hex');
  const ct = Buffer.from(String(json.ct), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function sign(hash, pem) {
  const sig = crypto.sign(null, Buffer.from(hash), { key: pem, format: 'pem', type: 'pkcs8' });
  return sig.toString('base64');
}

export async function ensureOwnerSignature() {
  const jsonPath = './swarm.constitution.json';
  const hash = computeConstitutionHashFromFile(jsonPath);
  const sigPath = './owner.signature';
  const existing = fs.existsSync(sigPath) ? fs.readFileSync(sigPath, 'utf8').trim() : null;
  if (existing && existing.length > 10) return { ok: true, reused: true };
  let privatePem = null;
  try {
    privatePem = fs.readFileSync('./owner_private.key', 'utf8');
  } catch {
    const backupPath = './backup/owner_private.key.enc';
    if (!fs.existsSync(backupPath)) return { ok: false, error: 'no_key_or_backup' };
    const secret = (process.env.OWNER_KEY_BACKUP_SECRET || process.env.CONSTITUTION_RUNTIME_SECRET || '').trim();
    if (!secret) return { ok: false, error: 'missing_backup_secret' };
    const raw = fs.readFileSync(backupPath, 'utf8');
    const parsed = JSON.parse(raw);
    privatePem = decryptBackup(parsed, secret);
  }
  const signatureB64 = sign(hash, privatePem);
  fs.writeFileSync(sigPath, signatureB64, 'utf8');
  return { ok: true, created: true };
}
