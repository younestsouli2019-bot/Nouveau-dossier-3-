// ─── Bybit AI Sub-Account OAuth — Local CLI helper ─────────────────────────
// Cloud-agent path (no local callback server):
//   1. $ node scripts/bybit-oauth-flow.mjs generate [MAINNET|TESTNET] [CONFIRM]
//        → prints authorization URL + writes session to ./.bybit-session.json
//   2. User opens URL, logs in to Bybit, clicks Authorize, copies the
//      access_token from the success page.
//   3. $ node scripts/bybit-oauth-flow.mjs authorize <paste-access-token> [index]
//        → calls /oauth/v1/resource/restrict/ai_accounts, stores creds in
//          process.env-style mask in .env.bybit.local, and runs a ccxt
//          fetchBalance-style probe.
//
// Safety rules implemented:
//   - MAINNET by default. TESTNET requires arg2 = "CONFIRM"
//   - Secrets printed to stdout ONLY ever as:
//       apiKey   → first5••••last4
//       apiSecret → ••••last5
//   - Server time / diff / balance are always tagged [MAINNET] or [TESTNET]
//   - No raw value ever touches log output or session JSON (only masked)
// ───────────────────────────────────────────────────────────────────────────

import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ENV_FILE = path.resolve(process.cwd(), '.env.bybit.local')
const SESSION_FILE = path.resolve(process.cwd(), '.bybit-session.json')

const BASE_MAINNET = 'https://api2.bybit.com'
const BASE_TESTNET = 'https://api2-testnet.bybit.com'
const WWW_MAINNET = 'https://www.bybit.com'
const WWW_TESTNET = 'https://testnet.bybit.com'

function urlSafeB64(buf) {
  return buf.toString('base64url').replace(/=+$/, '')
}
function verifier() { return urlSafeB64(randomBytes(48)) }
function challenge(v) { return urlSafeB64(createHash('sha256').update(v).digest()) }
function state() { return urlSafeB64(randomBytes(24)) }
function maskKey(k) {
  if (!k || k.length <= 9) return '••••'
  return `${k.slice(0, 5)}••••${k.slice(-4)}`
}
function maskSecret(s) {
  if (!s || s.length <= 5) return '••••'
  return `••••${s.slice(-5)}`
}

function log(tag, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${tag} ${msg}`)
}

async function cmdGenerate(argv) {
  let env = 'MAINNET'
  if (argv[0] === 'TESTNET') {
    if (argv[1] !== 'CONFIRM') {
      console.error('SAFETY: Switching to TESTNET requires exact word CONFIRM as the next argument.')
      console.error('  Usage: node scripts/bybit-oauth-flow.mjs generate TESTNET CONFIRM')
      process.exit(2)
    }
    env = 'TESTNET'
  }
  const v = verifier()
  const c = challenge(v)
  const st = state()
  const base = env === 'MAINNET' ? WWW_MAINNET : WWW_TESTNET
  const u = new URL(`${base}/en/account/oauth`)
  u.searchParams.set('client_id', 'ai-agent')
  u.searchParams.set('scope', 'ai-account')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('code_challenge', c)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', st)

  const session = {
    env,
    state: st,
    verifier: v,
    challenge: c,
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 })

  const ENV_LABEL = env === 'MAINNET' ? '[MAINNET]' : '[TESTNET]'
  console.log('')
  console.log(`═══════ Bybit Agent Connect — OAuth Authorization URL ${ENV_LABEL} ═══════`)
  console.log('')
  console.log(`1. Open this URL in your browser (Ctrl+click):`)
  console.log(`   ${u.toString()}`)
  console.log('')
  console.log('2. Log in to www.bybit.com and review the permission scopes:')
  console.log('   ✅  Create AI sub-account')
  console.log('   ✅  Create API key for AI sub-account')
  console.log('   ✅  Trade within AI sub-account')
  console.log('   ✅  Query AI sub-account positions')
  console.log('   ❌  Withdraw funds — NOT included')
  console.log('   ❌  View / modify email / 2FA — NOT included')
  console.log('   ❌  Access main account balance — NOT included')
  console.log('')
  console.log('3. Click Authorize. On the success screen, copy the access_token value.')
  console.log('   (Cloud-agent path — no local 127.0.0.1:9876 callback listener required)')
  console.log('')
  console.log(`4. Back here run:  node scripts/bybit-oauth-flow.mjs authorize "<paste-token>"`)
  console.log('   (add [index] to pick a specific AI sub-account, default 0)')
  console.log('')
  console.log(`Session state persisted (${path.relative(process.cwd(), SESSION_FILE)}).`)
  console.log('')
}

async function cmdAuthorize(argv) {
  const [accessToken, idxArg] = argv
  if (!accessToken || accessToken.trim() === '') {
    console.error('Usage: node scripts/bybit-oauth-flow.mjs authorize "<paste-access-token>" [index]')
    process.exit(2)
  }
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
  if (!session || !session.env) {
    console.error('No session found. Run "generate" first.')
    process.exit(2)
  }
  const env = session.env
  const ENV_LABEL = env === 'MAINNET' ? '[MAINNET]' : '[TESTNET]'
  const API = env === 'MAINNET' ? BASE_MAINNET : BASE_TESTNET

  log(ENV_LABEL, 'Calling GET /oauth/v1/resource/restrict/ai_accounts …')
  const res = await fetch(`${API}/oauth/v1/resource/restrict/ai_accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (json.retCode !== 0) throw new Error(`retCode=${json.retCode} ${json.retMsg}`)

  const list = (json.result?.aiAccounts ?? json.result?.list ?? [])
  if (!list.length) {
    console.error(`SAFETY ${ENV_LABEL}: No AI sub-accounts returned. Create one on Bybit first (up to 5 per account), then re-run generate/authorize.`)
    process.exit(3)
  }
  const idx = typeof idxArg === 'string' ? parseInt(idxArg, 10) || 0 : 0
  const acct = list[idx] ?? list[0]
  if (acct.apiKey) acct.apiKey = String(acct.apiKey)
  if (acct.apiSecret) acct.apiSecret = String(acct.apiSecret)

  console.log('')
  console.log(`═══════ Bybit AI Sub-Accounts ${ENV_LABEL} — ${list.length} available ═══════`)
  list.forEach((a, i) => {
    const mark = i === (list.indexOf(acct)) ? '◀ SELECTED' : ''
    console.log(`  [${i}] subAccountId=${a.subAccountId} name=${a.subAccountName ?? '(default)'} key=${maskKey(a.apiKey)} secret=${maskSecret(a.apiSecret)} ${mark}`)
  })
  console.log('')

  const envLines = [
    `# Bybit ${env} AI sub-account — authorized at ${new Date().toISOString()}`,
    `BYBIT_ENV=${env}`,
    `BYBIT_SUBACCOUNT_ID=${acct.subAccountId}`,
    `BYBIT_SUBACCOUNT_NAME=${acct.subAccountName ?? ''}`,
    `BYBIT_API_KEY=${acct.apiKey}`,
    `BYBIT_API_SECRET=${acct.apiSecret}`,
    acct.passphrase ? `BYBIT_API_PASSPHRASE=${acct.passphrase}` : '',
    `# Display masks:  key=${maskKey(acct.apiKey)}   secret=${maskSecret(acct.apiSecret)}`,
    `# Default transfer cap (set on Bybit): 5,000 USDT main → AI sub`,
    `# Revoke at any time: delete the AI sub-account on https://www.bybit.com`,
    '',
  ].filter(Boolean).join('\n')

  fs.writeFileSync(ENV_FILE, envLines, { mode: 0o600 })

  log(ENV_LABEL, `Credentials vaulted to ${path.relative(process.cwd(), ENV_FILE)} (mode 0600)`)
  log(ENV_LABEL, `Masked API key    : ${maskKey(acct.apiKey)}`)
  log(ENV_LABEL, `Masked API secret : ${maskSecret(acct.apiSecret)}`)
  console.log('')
  log(ENV_LABEL, 'Running signed verification probe (fetchTime → loadMarkets → fetchBalance) …')
  log(ENV_LABEL, 'SAFETY: No orders placed, no transfers executed. Read-only balance probe.')
  console.log('')

  try {
    const { bybitProbe } = await import('./bybit-probe.mjs')
    const out = await bybitProbe({
      env,
      apiKey: acct.apiKey,
      apiSecret: acct.apiSecret,
      passphrase: acct.passphrase,
    })
    console.log(`═══════ Verification Result ${ENV_LABEL} ═══════`)
    console.log(out)
  } catch (e) {
    log(ENV_LABEL, `Verification skipped (ccxt not installed or probe failed): ${e.message}`)
    console.log('')
    console.log(`You can run:   node scripts/verify-bybit.mjs   once the ccxt import path is fixed.`)
  }

  console.log('')
  console.log(`Next: Open Swarm Command Center → "Payouts & Wallets" → Bybit Authorize button`)
  console.log(`  to register this AI sub-account in the swarm's OwnerAccount ledger + link to payout batches.`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'generate') return cmdGenerate(rest)
  if (cmd === 'authorize') return cmdAuthorize(rest)
  console.error(
    'Bybit AI Sub-Account OAuth (Agent Connect) — cloud-agent flow\n\n' +
      '  generate [MAINNET|TESTNET] [CONFIRM]   create PKCE URL + session\n' +
      '  authorize <access-token> [idx]         exchange token → save creds → probe balance\n',
  )
  process.exit(1)
}
main().catch((e) => {
  console.error('\nFATAL:', e.message)
  console.error(e.stack)
  process.exit(1)
})
