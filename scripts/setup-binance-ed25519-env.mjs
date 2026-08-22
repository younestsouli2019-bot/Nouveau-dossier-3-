import crypto from "crypto";
import fs from "fs";
import path from "path";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function atomicAppendEnv(lines) {
  const file = path.resolve(".env");
  const text = lines.join("\n") + "\n";
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, text);
      return;
    }
    fs.appendFileSync(file, text);
  } catch {}
}

function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

async function main() {
  const seed = crypto.randomBytes(32);
  const seedHex = hex(seed);
  const secretsDir = path.resolve("secrets");
  const keyFile = path.join(secretsDir, "binance_ed25519_seed.hex");
  ensureDir(keyFile);
  fs.writeFileSync(keyFile, seedHex, { encoding: "utf8", mode: 0o600 });

  const lines = [
    `BINANCE_ED25519_PRIVATE_KEY_FILE=${keyFile}`,
    `BINANCE_SIGNATURE_ENCODING=hex`,
  ];
  atomicAppendEnv(lines);
}

main().catch(() => process.exit(1));
