#!/usr/bin/env node
/**
 * owner-bitget-withdraw.mjs — sweep swarm revenue (USDT by default) from
 * Bitget to one of the pre-set owner crypto routes.
 *
 * Why Bitget: Binance (451) and Bybit (403) geo-block US egress IPs
 * (GitHub runners + agent sandbox); Bitget's API is reachable from US
 * egress, so this rail executes without a non-US relay.
 *
 * FAIL-CLOSED rules (mirrors execute-crypto-withdraw.mjs):
 *  - DRY-RUN BY DEFAULT. Real submission requires BOTH --execute AND
 *    SWARM_LIVE=true.
 *  - The destination is resolved from the pre-set, verified owner routes in
 *    config/crypto-addresses.json (scripts/lib/owner-routes.mjs) by --route id
 *    or by --asset/--network. A destination supplied out-of-band
 *    (OWNER_CRYPTO_ADDRESS) is only cross-checked against that route, never
 *    substituted for it; an unresolvable route aborts.
 *  - On top of that the resolved address must be in CRYPTO_ALLOWED_ADDRESSES.
 *  - Amount capped by OWNER_BITGET_MAX_USDT (default 60).
 *  - Balance is fetched and verified BEFORE any submit; amount > available
 *    aborts.
 *  - Every attempt (dry or live, success or failure) is appended to
 *    data/out/bitget-withdraw-ledger.ndjson for reconciliation.
 *
 * Usage:
 *   node scripts/owner-bitget-withdraw.mjs --amount 60            # dry-run
 *   node scripts/owner-bitget-withdraw.mjs --amount 60 --route bitget-usdt-bep20
 *   SWARM_LIVE=true node scripts/owner-bitget-withdraw.mjs --amount 60 --network BEP20 --execute
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import ccxt from "ccxt";
import { loadRoutes, resolveRoute, listRoutes, fold } from "./lib/owner-routes.mjs";

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
  async getAvailable(asset = "USDT") {
    if (!this.credsPresent) return null;
    const bal = await this.exchange.fetchBalance();
    const entry = bal?.[asset];
    return Number(entry?.free ?? entry?.total ?? 0);
  }
  async withdrawAsset({ asset = "USDT", address, amount, clientOid, network = "BEP20" }) {
    if (!this.credsPresent) throw new Error("Bitget credentials missing");
    const params = { network: network === "BEP20" ? "BSC" : network };
    if (clientOid) params.clientOid = String(clientOid);
    const tx = await this.exchange.withdraw(asset, String(amount), address, undefined, params);
    return { withdrawId: tx?.id ?? null, network, asset, raw: tx };
  }
}

// Accepted --network shorthands, folded onto the registry's network names.
const NETWORK_ALIASES = {
  bsc: "BEP20", bnb: "BEP20", bep20: "BEP20",
  erc20: "ERC20", eth: "ERC20", ethereum: "ERC20",
  trc20: "TRC20", tron: "TRC20",
  btc: "BTC", bitcoin: "BTC",
};

function canonicalNetwork(input) {
  const s = String(input ?? "").trim();
  return NETWORK_ALIASES[s.toLowerCase()] ?? s.toUpperCase();
}

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
  const network = canonicalNetwork(getArg("--network", "BEP20"));
  const asset = String(getArg("--asset", "USDT")).trim().toUpperCase();
  const routeId = getArg("--route", null);
  const execute = process.argv.includes("--execute") && envIsTrue(process.env.SWARM_LIVE);

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

  // Destination first: no credential read, no balance call, no send until a
  // verified owner route has been resolved from the registry.
  let registry;
  try {
    registry = loadRoutes();
  } catch (err) {
    console.error(`FAIL-CLOSED: owner route registry unreadable — ${err.message}`);
    record({ status: "ABORTED", reason: "route registry unreadable", amount });
    process.exit(1);
  }
  const resolved = routeId
    ? resolveRoute(registry, { id: routeId })
    : resolveRoute(registry, { rail: "bitget", asset, network });
  if (!resolved.ok) {
    console.error(`FAIL-CLOSED: ${resolved.code} — ${resolved.error}`);
    console.error(`available routes: ${listRoutes(registry).map((r) => r.id).join(", ")}`);
    record({ status: "ABORTED", reason: resolved.code, amount, asset, network });
    process.exit(1);
  }
  const route = resolved.route;

  // A dispatch-supplied destination must BE the registered one. Anything else
  // is a substitution of a wallet the owner never verified: refuse.
  const supplied = String(process.env.OWNER_CRYPTO_ADDRESS ?? "").trim();
  if (supplied && fold(supplied) !== fold(route.address)) {
    console.error(`FAIL-CLOSED: supplied destination is not the registered address of route "${route.id}".`);
    record({ status: "ABORTED", reason: "ROUTE_ADDRESS_MISMATCH", amount, routeId: route.id });
    process.exit(1);
  }
  const address = route.address;

  const allow = addressIsAllowlisted(address);
  if (allow !== true) {
    console.error(allow === null
      ? "FAIL-CLOSED: CRYPTO_ALLOWED_ADDRESSES is not set — live withdrawal refused without an allowlist."
      : "FAIL-CLOSED: destination wallet is not in CRYPTO_ALLOWED_ADDRESSES.");
    record({ status: "ABORTED", reason: allow === null ? "no allowlist" : "not allowlisted", amount, routeId: route.id });
    process.exit(1);
  }

  const client = new BitgetClient();
  if (!client.credsPresent) {
    console.error("FAIL-CLOSED: BITGET_API_KEY / BITGET_API_SECRET / BITGET_PASSPHRASE not all present.");
    record({ status: "ABORTED", reason: "credentials missing", amount, routeId: route.id });
    process.exit(1);
  }

  let available;
  try {
    available = await client.getAvailable(route.asset);
  } catch (err) {
    console.error("Bitget balance read failed:", err.message);
    record({ status: "ABORTED", reason: "balance read failed", amount, error: String(err.message).slice(0, 200) });
    process.exit(1);
  }
  if (available === null || !Number.isFinite(available)) {
    console.error(`Could not read Bitget ${route.asset} balance.`);
    record({ status: "ABORTED", reason: "balance unreadable", amount });
    process.exit(1);
  }
  console.log(`Bitget ${route.asset} available: ${available}`);
  if (amount > available) {
    console.error(`FAIL-CLOSED: requested ${amount} ${route.asset} exceeds available ${available}.`);
    record({ status: "ABORTED", reason: "insufficient balance", amount, available });
    process.exit(1);
  }

  const clientOid = `OWNER-BITGET-WD-${Date.now()}`;
  if (!execute) {
    console.log(`DRY-RUN OK — would withdraw ${amount} ${route.asset} (${route.network}) to ${address} via route ${route.id} (clientOid=${clientOid}). No exchange call made.`);
    record({ status: "DRY_RUN", amount, asset: route.asset, network: route.network, routeId: route.id, address, clientOid, available });
    return;
  }

  console.log(`EXECUTING live withdrawal: ${amount} ${route.asset} (${route.network}) → ${address} via route ${route.id}`);
  try {
    const res = await client.withdrawAsset({ asset: route.asset, address, amount, clientOid, network: route.network });
    console.log("WITHDRAW SUBMITTED");
    console.log(JSON.stringify({ ok: true, provider: "bitget", routeId: route.id, asset: route.asset, withdrawId: res.withdrawId, network: res.network, amount, address, clientOid }, null, 2));
    record({ status: "SUBMITTED", amount, asset: route.asset, network: route.network, routeId: route.id, address, clientOid, withdrawId: res.withdrawId });
  } catch (err) {
    console.error("Withdrawal failed:", err.message);
    record({ status: "FAILED", amount, asset: route.asset, network: route.network, routeId: route.id, address, clientOid, error: String(err.message).slice(0, 300) });
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
