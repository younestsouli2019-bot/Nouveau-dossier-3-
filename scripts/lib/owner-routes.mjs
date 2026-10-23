// scripts/lib/owner-routes.mjs
// ---------------------------------------------------------------------------
// Pre-set, verified owner payout routes.
//
// A "route" is one destination the owner has already approved for a given
// (rail, asset, network). Resolving through a registry instead of a single
// hardcoded constant is what lets the rails carry several destinations — but
// flexibility must not become a bypass, so resolution is fail-closed:
//
//   - unknown or ambiguous route      -> refused
//   - verified !== true               -> refused
//   - no address declared             -> refused
//   - address is an exchange deposit  -> refused (funds would bounce back)
//   - address shape wrong for the net -> refused
//
// There is no default destination and no fallback chain: a rail that cannot
// resolve a route must not send. Callers get a structured verdict, never a
// silent substitution.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "ethers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

export const MANIFEST_PATH =
  process.env.CRYPTO_ADDRESS_MANIFEST || path.join(ROOT, "config", "crypto-addresses.json");

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

// Networks whose addresses must be EVM-shaped. A route pairing an EVM network
// with a non-EVM address is a typo that would send funds into nothing.
const EVM_NETWORKS = new Set([
  "BEP20", "BSC", "BNB", "ERC20", "ETH", "ETHEREUM",
  "POLYGON", "BASE", "ARBITRUM", "OPTIMISM", "AVAXC",
]);

export function fold(raw) {
  const s = String(raw ?? "").trim();
  return s.startsWith("0x") || s.startsWith("0X") ? s.toLowerCase() : s;
}

/** EIP-55 canonical form for EVM addresses; other chains are returned trimmed. */
export function canonicalAddress(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return EVM_RE.test(s) ? getAddress(s.toLowerCase()) : s;
}

function shapeError(network, address) {
  if (!address) return null;
  const net = String(network).trim().toUpperCase();
  const shape = [net];
  if (net.startsWith("TRC") || net === "TRON") shape.length = 0, shape.push("TRON");
  if (shape.includes("TRON")) {
    return TRON_RE.test(address) ? null : `network ${network} expects a Tron (T...) address`;
  }
  if (EVM_NETWORKS.has(net)) {
    return EVM_RE.test(address) ? null : `network ${network} expects a 0x… EVM address`;
  }
  return null;
}

/**
 * Read the route registry from the canonical manifest.
 * Throws on a malformed manifest: a registry we cannot fully parse must never
 * be treated as "no routes declared, carry on".
 */
export function loadRoutes(file = MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = manifest?.routes?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`no owner routes declared in ${file}`);
  }

  const depositFolded = new Set(
    Object.values(manifest?.depositRoutes?.networks ?? {}).map((a) => fold(a)),
  );

  const routes = list.map((r) => {
    if (!r?.id || !r?.asset || !r?.network) {
      throw new Error(`route entry missing id/asset/network: ${JSON.stringify(r ?? null).slice(0, 120)}`);
    }
    const address = canonicalAddress(r.address);
    // An entry that carries an address but verified=false is still unusable:
    // the owner has not confirmed the destination, so nothing is armed.
    return {
      id: String(r.id),
      rail: r.rail ? String(r.rail) : null,
      asset: String(r.asset),
      network: String(r.network),
      address,
      verified: r.verified === true && !!address,
      declaredVerified: r.verified === true,
      verifiedVia: r.verifiedVia ?? null,
      note: r.note ?? null,
    };
  });

  const seen = new Set();
  for (const r of routes) {
    if (seen.has(r.id)) throw new Error(`duplicate route id "${r.id}"`);
    seen.add(r.id);
  }

  return {
    routes,
    byId: new Map(routes.map((r) => [r.id, r])),
    depositFolded,
    verifiedAt: manifest?.routes?.verifiedAt ?? null,
  };
}

const norm = (v) => String(v ?? "").trim().toUpperCase();

/**
 * Resolve one owner destination, by explicit id or by (rail, asset, network).
 * @returns {{ok: true, route: object} | {ok: false, code: string, error: string, route?: object}}
 */
export function resolveRoute(registry, { id, rail, asset, network } = {}) {
  if (!registry?.byId) {
    return { ok: false, code: "REGISTRY_MISSING", error: "route registry not loaded" };
  }

  let route;
  if (id) {
    route = registry.byId.get(String(id).trim());
    if (!route) return { ok: false, code: "ROUTE_UNKNOWN", error: `no route with id "${id}"` };
  } else {
    if (!asset || !network) {
      return {
        ok: false,
        code: "ROUTE_UNDERSPECIFIED",
        error: "resolveRoute needs a route id, or an asset and a network",
      };
    }
    const label = `${rail ? `${rail}/` : ""}${asset}/${network}`;
    const matches = registry.routes.filter(
      (r) =>
        norm(r.asset) === norm(asset) &&
        norm(r.network) === norm(network) &&
        (!rail || norm(r.rail) === norm(rail)),
    );
    if (matches.length === 0) {
      return { ok: false, code: "ROUTE_UNKNOWN", error: `no owner route for ${label}` };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: "ROUTE_AMBIGUOUS",
        error: `${matches.length} routes match ${label}: ${matches.map((r) => r.id).join(", ")} — name one explicitly`,
      };
    }
    route = matches[0];
  }

  if (!route.declaredVerified) {
    return {
      ok: false,
      code: "ROUTE_UNVERIFIED",
      route,
      error: `route "${route.id}" is not verified${route.address ? "" : " and declares no address"} — refusing to send`,
    };
  }
  if (!route.address) {
    return { ok: false, code: "ROUTE_NO_ADDRESS", route, error: `route "${route.id}" declares no address` };
  }
  if (registry.depositFolded.has(fold(route.address))) {
    return {
      ok: false,
      code: "ROUTE_IS_DEPOSIT",
      route,
      error: `route "${route.id}" points at an exchange deposit address, not an owner wallet`,
    };
  }
  const bad = shapeError(route.network, route.address);
  if (bad) {
    return { ok: false, code: "ROUTE_SHAPE_MISMATCH", route, error: `route "${route.id}": ${bad}` };
  }

  return { ok: true, route };
}

/** Operator-facing inventory. Addresses are public; nothing else is echoed. */
export function listRoutes(registry) {
  return (registry?.routes ?? []).map((r) => ({
    id: r.id,
    rail: r.rail,
    asset: r.asset,
    network: r.network,
    usable:
      r.declaredVerified &&
      !!r.address &&
      !registry.depositFolded.has(fold(r.address)) &&
      !shapeError(r.network, r.address),
    address: r.address,
  }));
}
