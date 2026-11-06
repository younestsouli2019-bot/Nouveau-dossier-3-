#!/usr/bin/env node
/** Focused tests for the shared Shopify credential resolver. */
import { resolveShopifyToken, validateTokenShape, describeToken } from './lib/shopify-credentials.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

const token = resolveShopifyToken({ SHOPIFY_ADMIN_API_TOKEN: 'shpat_new', SHOPIFY_ADMIN_API_KEY: 'shpat_old' });
ok('prefers SHOPIFY_ADMIN_API_TOKEN', token.value === 'shpat_new' && token.source === 'SHOPIFY_ADMIN_API_TOKEN');

const legacy = resolveShopifyToken({ SHOPIFY_ADMIN_API_KEY: 'shpat_old' });
ok('falls back to SHOPIFY_ADMIN_API_KEY', legacy.value === 'shpat_old' && legacy.legacy === true);

const messy = resolveShopifyToken({ SHOPIFY_ADMIN_API_KEY: '  "shpat_spaced"  ' });
ok('trims quotes and whitespace', messy.value === 'shpat_spaced', messy.value);

const empty = resolveShopifyToken({});
ok('missing resolves to empty', empty.value === '' && empty.source === null);

ok('accepts shpat_ token', validateTokenShape('shpat_abc123').ok === true);
ok('rejects 32-char hex as a Client ID', validateTokenShape('0123456789abcdef0123456789abcdef').error === 'client_id_detected');
ok('flags an unrecognized prefix without blocking', validateTokenShape('weird_value').error === 'unrecognized_prefix');
ok('never echoes the full secret', !describeToken('shpat_abcdef123456').includes('abcdef123456'));

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
