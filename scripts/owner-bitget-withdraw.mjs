#!/usr/bin/env node
/**
 * owner-bitget-withdraw.mjs — sweep swarm revenue USDT from Bitget to the
 * pre-set owner crypto wallet.
 *
 * Why Bitget: Binance (451) and Bybit (403) geo-block US egress IPs
 * (GitHub runners + agent sandbox); Bitget's API is reachable from US
 * egress, so this rail executes without a non-US relay.
 *
 * FAIL-CLOSED rules (mirrors execute-crypto-withdraw.mjs):
 *  - DRY-RUN BY DEFAULT. Real submission requires BOTH --execute AND
 *    SWARM_LIVE=true.
 *  - Destination must be in CRYPTO_ALLOWED_ADDRESSES (repo secret).
 *  - Amount capped by OWNER_BITGET_MAX_USDT (default 60).
 *  - Balance is fetched and verified BEFORE any submit; amount > available
 *    aborts.
 *  - Every attempt (dry or live, success or failure) is appended to
 *    data/out/bitget-withdraw-ledger.ndjson for reconciliation.
 *
 * Usage:
 *   node scripts/owner-bitget-withdraw.mjs --amount 60            # dry-run
 *   SWARM_LIVE=true node scripts/owner-bitget-withdraw.mjs --amount 60 --execute
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import ccxt from "ccxt";

// Minimal Bitget client (ccxt) — mirrors BitgetClient in src/crypto/crypto-rail.mjs
// but avoids importing that module, which transitively requires @binance/connector.
class BitgetClient {
  constructor() {
    this.apiKey = process.env.BITGET_API_KEY;
    this.apiSecret = process.env.BITGET_API_SECRET;
    this.passphrase = process.env.BITGET_PASSPHRASE;
    this.exchange = new ccxt.bitget({
      apiKey: this.apiKey ?? "",
      secret: this.apiSecret ?? "",
      password: this.passphrase ?? "",
      enableRateLimit: true,
      timeout: 30000,
    });
  }
  get credsPresent() { return !!(this.apiKey && this.apiSecret && this.passphrase); }
  async getUsdtAvailable() {
    if (!this.credsPresent) return null;
    const bal = await this.exchange.fetchBalance();
    const usdt = bal?.USDT;
    return Number(usdt?.free ?? usdt?.total ?? 0);
  }
  async withdrawUSDT({ address, amount, clientOid, network = "BEP20" }) {
    if (!this.credsPresent) throw new Error("Bitget credentials missing");
    const params = { network: network === "BEP20" ? "BSC" : network };
    if (clientOid) params.clientOid = String(clientOid);
    const tx = await this.exchange.withdraw("USDT", String(amount), address, undefined, params);
    return { withdrawId: tx?.id ?? null, network, raw: tx };
  }
}

const OWNER_WALLET = "0xA46225a984E2B2b5E5082E52ae8d8915A09FEFE7";
const MAX_DEFAULT = 60;
const LEDGER = path.resolve("data", "out", "bitget-withdraw-ledger.ndjson");

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : def;
}

function envIsTrue(v) {
  return /^(1|true|yes|on)$/i.test(String(v ?? "").trim());
}

function addressIsAllowlisted(address) {
  const raw = process.env.CRYPTO_ALLOWED_ADDRESSES ?? process.env.ALLOWED_WITHDRAW_ADDRESSES;
  if (!String(raw ?? "").trim()) return null; // allowlist not configured
  const wanted = String(address).trim().toLowerCase();
  for (const part of String(raw).split(",")) {
    const clean = part.trim().replace(/\r/g, "");
    if (clean && clean.toLowerCase() === wanted) return true;
  }
  return false;
}

function record(entry) {
  try {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch (err) {
    console.error("[ledger] append failed", err.message);
  }
}

async function main() {
  const amount = Number(getArg("--amount", MAX_DEFAULT));
  const network = String(getArg("--network", "BEP20")).toUpperCase();
  const execute = process.argv.includes("--execute") && envIsTrue(process.env.SWARM_LIVE);
  const address = OWNER_WALLET;

  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("amount must be a positive number");
    process.exit(1);
  }
  const cap = Number(process.env.OWNER_BITGET_MAX_USDT ?? MAX_DEFAULT) || MAX_DEFAULT;
  if (amount > cap) {
    console.error(`FAIL-CLOSED: amount ${amount} exceeds cap ${cap} (OWNER_BITGET_MAX_USDT)`);
    record({ status: "ABORTED", reason: "amount over cap", amount });
    process.exit(1);
  }
  const allow = addressIsAllowlisted(address);
  if (allow !== true) {
    console.error(allow === null
      ? "FAIL-CLOSED: CRYPTO_ALLOWED_ADDRESSES is not set — live withdrawal refused without an allowlist."
      : "FAIL-CLOSED: destination wallet is not in CRYPTO_ALLOWED_ADDRESSES.");
    record({ status: "ABORTED", reason: allow === null ? "no allowlist" : "not allowlisted", amount });
    process.exit(1);
  }

  const client = new BitgetClient();
  if (!client.credsPresent) {
    console.error("FAIL-CLOSED: BITGET_API_KEY / BITGET_API_SECRET / BITGET_PASSPHRASE not all present.");
    record({ status: "ABORTED", reason: "credentials missing", amount });
    process.exit(1);
  }

  let available;
  try {
    available = await client.getUsdtAvailable();
  } catch (err) {
    console.error("Bitget balance read failed:", err.message);
    record({ status: "ABORTED", reason: "balance read failed", amount, error: String(err.message).slice(0, 200) });
    process.exit(1);
  }
  if (available === null || !Number.isFinite(available)) {
    console.error("Could not read Bitget USDT balance.");
    record({ status: "ABORTED", reason: "balance unreadable", amount });
    process.exit(1);
  }
  console.log(`Bitget USDT available: ${available}`);
  if (amount > available) {
    console.error(`FAIL-CLOSED: requested ${amount} USDT exceeds available ${available}.`);
    record({ status: "ABORTED", reason: "insufficient balance", amount, available });
    process.exit(1);
  }

  const clientOid = `OWNER-BITGET-WD-${Date.now()}`;
  if (!execute) {
    console.log(`DRY-RUN OK — would withdraw ${amount} USDT (${network}) to ${address} (clientOid=${clientOid}). No exchange call made.`);
    record({ status: "DRY_RUN", amount, network, address, clientOid, available });
    return;
  }

  console.log(`EXECUTING live withdrawal: ${amount} USDT (${network}) → ${address}`);
  try {
    const res = await client.withdrawUSDT({ address, amount, clientOid, network });
    console.log("WITHDRAW SUBMITTED");
    console.log(JSON.stringify({ ok: true, provider: "bitget", withdrawId: res.withdrawId, network: res.network, amount, address, clientOid }, null, 2));
    record({ status: "SUBMITTED", amount, network, address, clientOid, withdrawId: res.withdrawId });
  } catch (err) {
    console.error("Withdrawal failed:", err.message);
    record({ status: "FAILED", amount, network, address, clientOid, error: String(err.message).slice(0, 300) });
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
