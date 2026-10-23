#!/usr/bin/env node
/**
 * Owner crypto ADDRESS rotation — converge the address-bearing repo secrets
 * onto config/crypto-addresses.json (the canonical manifest).
 *
 * Why this exists: several repo secrets still carry the retired checkout
 * address or a non-EIP-55 casing of the owner wallet (run 52 failed the
 * allowlist gate on casing alone). Addresses are public receive values, so
 * unlike keys they can be rotated autonomously — and they must be, otherwise
 * the payout rails keep pointing at a contract nobody owns any more.
 *
 * Modes:
 *   --inventory   classify the allowlist the runner actually received
 *                 (ALLOWED_WITHDRAW_ADDRESSES / CRYPTO_ALLOWED_ADDRESSES).
 *                 exit 3 when it still carries deprecated or unknown entries.
 *   --plan        print the exact secret writes, verify the signer guard.
 *   --execute     perform the writes (needs a token able to write repo
 *                 secrets: GITHUB_TOKEN / App installation token).
 *
 * Fail-closed: a signer-paired secret (an address whose private key is also
 * stored) is NEVER rewritten unless the key derives that exact address —
 * rewriting it blindly would desynchronise key and wallet.
 * Values are never logged: only addresses (public by nature) and verdicts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getAddress, Wallet } from "ethers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MANIFEST_PATH = process.env.CRYPTO_ADDRESS_MANIFEST || path.join(ROOT, "config", "crypto-addresses.json");
const EXIT_DRIFT = 3;
// A refusal is a deliberate guard outcome (e.g. the signer-paired secret cannot
// be verified), not an error: it gets its own exit code so CI can surface it as
// a warning instead of going red forever on a correct, intended behaviour.
const EXIT_REFUSED = 4;
const TAG = "crypto-address-rotation:";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function die(msg, code = 1) {
  console.error(`${TAG} ${msg}`);
  process.exit(code);
}

/** EIP-55 canonical form; throws on anything that is not a valid EVM address. */
export function canonicalEvm(raw) {
  const s = String(raw ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error(`not an EVM address: ${s}`);
  return getAddress(s.toLowerCase());
}

export function fold(raw) {
  const s = String(raw ?? "").trim();
  return s.startsWith("0x") || s.startsWith("0X") ? s.toLowerCase() : s;
}

export function loadManifest(file = MANIFEST_PATH) {
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!m?.canonical?.evm) die("manifest has no canonical.evm");
  m.canonical.evm = canonicalEvm(m.canonical.evm);
  m.allowlist = (m.allowlist || []).map((a) => canonicalEvm(a));
  m.extraAllowlist = (m.extraAllowlist || []).map((a) => canonicalEvm(a));
  m.deprecated = (m.deprecated || []).map((d) => ({ ...d, address: canonicalEvm(d.address) }));
  // Custodial exchange deposit routes: documented and verified-live, but never
  // a payable destination. Kept as a hard guard rather than prose.
  m.depositFolded = new Set(Object.values(m.depositRoutes?.networks ?? {}).map((a) => fold(a)));
  if (!Array.isArray(m.targets) || !m.targets.length) die("manifest has no targets");
  return m;
}

/**
 * True when the address is a custodial exchange deposit route. These are live
 * (re-verified against the provider API) yet must never be written as an owner
 * destination: funds would land back on the exchange instead of self-custody.
 */
export function isDepositRoute(raw, manifest) {
  return (manifest.depositFolded ?? new Set()).has(fold(raw));
}

/** canonical | legacy-casing | deprecated | unknown */
export function classify(raw, manifest) {
  const folded = fold(raw);
  for (const d of manifest.deprecated) if (fold(d.address) === folded) return "deprecated";
  try {
    const canon = canonicalEvm(raw);
    if (canon === manifest.canonical.evm || manifest.allowlist.includes(canon)) {
      return canon === String(raw).trim() ? "canonical" : "legacy-casing";
    }
    if (folded === fold(manifest.canonical.evm)) return "legacy-casing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function parseAllowlist(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Address derived from a stored private key, or null when unavailable/invalid. */
export function addressFromKey(pkEnv) {
  const pk = String(process.env[pkEnv] ?? "").trim();
  if (!pk) return null;
  try {
    return canonicalEvm(new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`).address);
  } catch {
    return null;
  }
}

/** Target secret writes implied by the manifest. `refused` holds signer guards unmet. */
export function computeTargets(manifest) {
  const writes = [];
  const refused = [];
  const allowlistValue = [...manifest.allowlist, ...manifest.extraAllowlist].join(",");
  for (const t of manifest.targets) {
    if (t.mode === "allowlist") {
      writes.push({ secret: t.secret, value: allowlistValue, mode: t.mode });
      continue;
    }
    if (t.mode === "destination") {
      writes.push({ secret: t.secret, value: manifest.canonical.evm, mode: t.mode });
      continue;
    }
    if (t.mode === "signer") {
      const derived = addressFromKey(t.guardEnv);
      if (!derived) {
        refused.push({ secret: t.secret, why: `cannot verify guard ${t.guardEnv} (key missing or unreadable)` });
      } else if (fold(derived) === fold(manifest.canonical.evm)) {
        writes.push({ secret: t.secret, value: manifest.canonical.evm, mode: t.mode });
      } else {
        refused.push({
          secret: t.secret,
          why: `${t.guardEnv} derives ${derived}, manifest says ${manifest.canonical.evm} — key rotation required by the owner, refusing to desynchronise`,
        });
      }
      continue;
    }
    die(`unknown target mode "${t.mode}" for ${t.secret}`);
  }
  for (const w of writes) {
    if (classify(w.value, manifest) === "deprecated") die(`refusing to write deprecated address into ${w.secret}`);
    if (isDepositRoute(w.value, manifest)) die(`refusing to write exchange deposit route into ${w.secret} — an owner destination must be self-custody, not a deposit address`);
  }
  return { writes, refused };
}

function inventory() {
  const manifest = loadManifest();
  const raw = env("ALLOWED_WITHDRAW_ADDRESSES") || env("CRYPTO_ALLOWED_ADDRESSES");
  if (!raw) die("no allowlist in env (ALLOWED_WITHDRAW_ADDRESSES / CRYPTO_ALLOWED_ADDRESSES)");
  const entries = parseAllowlist(raw).map((e) => ({ entry: e, status: classify(e, manifest) }));
  const counts = entries.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
  const drift = entries.filter((e) => e.status === "deprecated" || e.status === "unknown");
  const out = {
    total: entries.length,
    counts: {
      canonical: counts.canonical || 0,
      "legacy-casing": counts["legacy-casing"] || 0,
      deprecated: counts.deprecated || 0,
      unknown: counts.unknown || 0,
    },
    canonicalTarget: manifest.canonical.evm,
    converged: drift.length === 0,
    entries,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.converged) {
    console.error(
      `${TAG} DRIFT: ${drift.length} allowlist entr(ies) are deprecated or unknown — run the rotation.`,
    );
    process.exit(EXIT_DRIFT);
  }
  console.log(`${TAG} allowlist converged on ${manifest.canonical.evm}`);
}

const env = (k) => String(process.env[k] ?? "").trim();

function plan() {
  const manifest = loadManifest();
  const { writes, refused } = computeTargets(manifest);
  console.log(`${TAG} canonical: ${manifest.canonical.evm}`);
  for (const w of writes) {
    console.log(`${TAG}   would set ${w.secret} (${w.mode}) = ${w.value}`);
  }
  for (const r of refused) console.error(`${TAG}   REFUSED ${r.secret}: ${r.why}`);
  console.log(`${TAG} plan: ${writes.length} write(s), ${refused.length} refused`);
  if (refused.length) process.exit(EXIT_REFUSED);
}

function execute() {
  const repo = valueOf("--repo") || env("GITHUB_REPOSITORY");
  if (!repo) die("--execute needs --repo owner/name (or GITHUB_REPOSITORY)");
  const manifest = loadManifest();
  const { writes, refused } = computeTargets(manifest);
  for (const r of refused) console.error(`${TAG}   REFUSED ${r.secret}: ${r.why}`);
  if (!writes.length) die("nothing to write — every target was refused");
  const args = [path.join(HERE, "rotate-repo-secrets.mjs"), "--repo", repo];
  for (const w of writes) args.push("--secret", `${w.secret}=${w.value}`);
  execFileSync(process.execPath, args, { stdio: "inherit", env: process.env });
  console.log(`${TAG} rotated ${writes.length} secret(s); ${refused.length} refused (see above)`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (has("--inventory")) inventory();
  else if (has("--execute")) execute();
  else if (has("--plan")) plan();
  else die("usage: rotate-crypto-addresses.mjs --inventory | --plan | --execute --repo owner/name  (exit 3 = allowlist drift, 4 = plan produced refusals)");
}
