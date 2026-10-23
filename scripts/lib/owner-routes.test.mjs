import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  MANIFEST_PATH, fold, canonicalAddress, loadRoutes, resolveRoute, listRoutes,
} from './owner-routes.mjs';

const OWNER = '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7';
const OWNER_LOWER = '0xa46225a984e2b2b5e5082e52ae8d8915a09fefe7';
const OTHER_EVM = '0x1111111111111111111111111111111111111111';
const DEPOSIT_BEP20 = '0x2700732a6f050c10c080154ce73cc641c448b704';
const TRON = 'TUtM17RZ1jCrXPnLa34o7J59BSEqgqYYBE';

const tmpFiles = [];
function fixture(manifest) {
  const file = path.join(os.tmpdir(), `owner-routes-${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest));
  tmpFiles.push(file);
  return file;
}
afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

function manifestWith(list, networks = { BEP20: DEPOSIT_BEP20 }) {
  return { depositRoutes: { networks }, routes: { verifiedAt: '2026-01-01', list } };
}

const route = (over = {}) => ({
  id: 'bitget-usdt-bep20', rail: 'bitget', asset: 'USDT', network: 'BEP20',
  address: OWNER, verified: true, verifiedVia: 'test', note: null,
  ...over,
});

describe('fold / canonicalAddress', () => {
  it('lowercases EVM addresses and leaves other chains untouched', () => {
    expect(fold(OWNER)).toBe(OWNER_LOWER);
    expect(fold(TRON)).toBe(TRON);
    expect(fold('')).toBe('');
  });

  it('canonicalises EVM to EIP-55 and passes non-EVM through', () => {
    expect(canonicalAddress(OWNER_LOWER)).toBe(OWNER);
    expect(canonicalAddress(TRON)).toBe(TRON);
    expect(canonicalAddress(null)).toBeNull();
  });
});

describe('loadRoutes', () => {
  it('canonicalises the stored address and marks the route verified', () => {
    const reg = loadRoutes(fixture(manifestWith([route({ address: OWNER_LOWER })])));
    expect(reg.routes).toHaveLength(1);
    expect(reg.routes[0].address).toBe(OWNER);
    expect(reg.routes[0].verified).toBe(true);
    expect(reg.verifiedAt).toBe('2026-01-01');
  });

  it('throws when no registry is declared', () => {
    expect(() => loadRoutes(fixture({ depositRoutes: { networks: {} } }))).toThrow(/no owner routes/);
    expect(() => loadRoutes(fixture({ routes: { list: [] } }))).toThrow(/no owner routes/);
  });

  it('throws on a duplicate route id', () => {
    const dup = [route(), route({ network: 'ERC20' })];
    expect(() => loadRoutes(fixture(manifestWith(dup)))).toThrow(/duplicate route id/);
  });

  it('throws when an entry is missing id/asset/network', () => {
    expect(() => loadRoutes(fixture(manifestWith([route({ network: undefined })])))).toThrow(/missing id\/asset\/network/);
  });
});

describe('resolveRoute', () => {
  it('resolves an explicit id', () => {
    const reg = loadRoutes(fixture(manifestWith([route()])));
    const r = resolveRoute(reg, { id: 'bitget-usdt-bep20' });
    expect(r.ok).toBe(true);
    expect(r.route.address).toBe(OWNER);
  });

  it('resolves by rail + asset + network', () => {
    const reg = loadRoutes(fixture(manifestWith([route()])));
    expect(resolveRoute(reg, { rail: 'bitget', asset: 'usdt', network: 'bep20' }).ok).toBe(true);
  });

  it('refuses an unknown id', () => {
    const reg = loadRoutes(fixture(manifestWith([route()])));
    const r = resolveRoute(reg, { id: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROUTE_UNKNOWN');
  });

  it('refuses an unknown (rail, asset, network)', () => {
    const reg = loadRoutes(fixture(manifestWith([route()])));
    expect(resolveRoute(reg, { rail: 'binance', asset: 'USDT', network: 'BEP20' }).code).toBe('ROUTE_UNKNOWN');
    expect(resolveRoute(reg, { rail: 'bitget', asset: 'BTC', network: 'BTC' }).code).toBe('ROUTE_UNKNOWN');
  });

  it('refuses an underspecified request', () => {
    const reg = loadRoutes(fixture(manifestWith([route()])));
    expect(resolveRoute(reg, { rail: 'bitget' }).code).toBe('ROUTE_UNDERSPECIFIED');
    expect(resolveRoute(reg).code).toBe('ROUTE_UNDERSPECIFIED');
  });

  it('refuses an ambiguous request instead of picking one', () => {
    const reg = loadRoutes(fixture(manifestWith([
      route({ id: 'a' }),
      route({ id: 'b' }),
    ])));
    const r = resolveRoute(reg, { rail: 'bitget', asset: 'USDT', network: 'BEP20' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROUTE_AMBIGUOUS');
    expect(r.error).toMatch(/a, b/);
    // naming one of them explicitly still works
    expect(resolveRoute(reg, { id: 'b' }).ok).toBe(true);
  });

  it('refuses a route that is not verified', () => {
    const reg = loadRoutes(fixture(manifestWith([route({ verified: false })])));
    expect(resolveRoute(reg, { id: 'bitget-usdt-bep20' }).code).toBe('ROUTE_UNVERIFIED');
  });

  it('refuses an address-less route even when marked verified', () => {
    const reg = loadRoutes(fixture(manifestWith([route({ address: null })])));
    const r = resolveRoute(reg, { id: 'bitget-usdt-bep20' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROUTE_NO_ADDRESS');
  });

  it('refuses a destination that is an exchange deposit address', () => {
    const reg = loadRoutes(fixture(manifestWith([route({ address: DEPOSIT_BEP20 })])));
    const r = resolveRoute(reg, { id: 'bitget-usdt-bep20' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROUTE_IS_DEPOSIT');
  });

  it('refuses an address whose shape does not match the network', () => {
    const evmNetRronAddr = loadRoutes(fixture(manifestWith([route({ address: TRON })])));
    expect(resolveRoute(evmNetRronAddr, { id: 'bitget-usdt-bep20' }).code).toBe('ROUTE_SHAPE_MISMATCH');

    const tronNetEvmAddr = loadRoutes(fixture(manifestWith([
      route({ id: 't', network: 'TRC20', address: OWNER }),
    ])));
    expect(resolveRoute(tronNetEvmAddr, { id: 't' }).code).toBe('ROUTE_SHAPE_MISMATCH');
  });

  it('accepts a well-formed Tron route', () => {
    const reg = loadRoutes(fixture(manifestWith([
      route({ id: 't', network: 'TRC20', address: TRON }),
    ])));
    const r = resolveRoute(reg, { rail: 'bitget', asset: 'USDT', network: 'TRC20' });
    expect(r.ok).toBe(true);
    expect(r.route.address).toBe(TRON);
  });

  it('refuses when no registry was loaded', () => {
    expect(resolveRoute(null, { id: 'x' }).code).toBe('REGISTRY_MISSING');
  });
});

describe('listRoutes', () => {
  it('flags exactly the armed routes as usable', () => {
    const reg = loadRoutes(fixture(manifestWith([
      route({ id: 'ok' }),
      route({ id: 'unverified', verified: false }),
      route({ id: 'no-address', address: null }),
      route({ id: 'deposit', address: DEPOSIT_BEP20 }),
    ])));
    const byId = Object.fromEntries(listRoutes(reg).map((r) => [r.id, r.usable]));
    expect(byId).toEqual({ ok: true, unverified: false, 'no-address': false, deposit: false });
  });
});

describe('the repository manifest', () => {
  const reg = loadRoutes(MANIFEST_PATH);

  it('arms the verified BEP20 route and canonicalises its address', () => {
    const r = resolveRoute(reg, { rail: 'bitget', asset: 'USDT', network: 'BEP20' });
    expect(r.ok).toBe(true);
    expect(r.route.address).toBe(OWNER);
  });

  it('leaves TRC20 and BTC declared but refused', () => {
    expect(resolveRoute(reg, { rail: 'bitget', asset: 'USDT', network: 'TRC20' }).code).toBe('ROUTE_UNVERIFIED');
    expect(resolveRoute(reg, { id: 'bitget-btc-btc' }).code).toBe('ROUTE_UNVERIFIED');
  });

  it('never lets a deposit address be armed', () => {
    for (const r of listRoutes(reg)) {
      if (r.usable) expect(fold(r.address)).not.toBe(fold(DEPOSIT_BEP20));
    }
  });
});
