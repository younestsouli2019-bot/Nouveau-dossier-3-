import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";

function decode(b64) {
  try {
    return Buffer.from(String(b64), "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function loadEncryptedEnv() {
  const dir = path.resolve(process.cwd(), "data", "secrets");
  const file = path.join(dir, ".env.enc.json");
  if (!fs.existsSync(file)) return { ok: false, file, loaded: [] };
  const keyRaw = String(process.env.ENVBOX_KEY || "").trim();
  if (!keyRaw) return { ok: false, file, loaded: [], reason: "missing_key" };
  const key = decode(keyRaw);
  if (key.length !== nacl.secretbox.keyLength) {
    return { ok: false, file, loaded: [], reason: "bad_key_length" };
  }
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const nonce = decode(payload.nonce || "");
  const box = decode(payload.box || "");
  const opened = nacl.secretbox.open(new Uint8Array(box), new Uint8Array(nonce), new Uint8Array(key));
  if (!opened) return { ok: false, file, loaded: [], reason: "decrypt_failed" };
  const txt = Buffer.from(opened).toString("utf8");
  const entries = Object.entries(JSON.parse(txt));
  for (const [k, v] of entries) {
    if (!process.env[k]) process.env[k] = String(v);
  }
  return { ok: true, file, loaded: entries.map(([k]) => k) };
}

function main() {
  const r = loadEncryptedEnv();
  process.stdout.write(JSON.stringify(r) + "\n");
}

main();
