// ─── Bybit signed verification probe (ccxt-style, optional dependency) ──
// Tries to import ccxt. If ccxt is not installed it falls back to a manual
// signed REST call: GET /v5/account/wallet-balance?accountType=UNIFIED
//
// Safety:
//   - Every output line tagged [MAINNET] or [TESTNET]
//   - Raw credentials never in logs — uses the values passed in-process only
//   - Place orders / transfers are NEVER called (only GET read endpoints)
// ─────────────────────────────────────────────────────────────────────────

import { createHmac } from 'node:crypto'

const BASE_MAINNET = 'https://api2.bybit.com'
const BASE_TESTNET = 'https://api2-testnet.bybit.com'

function signParams({ apiKey, apiSecret, timestamp, recvWindow, params }) {
  const qs = new URLSearchParams(params).toString()
  const payload = `${timestamp}${apiKey}${recvWindow ?? ''}${qs}`
  const sign = createHmac('sha256', apiSecret).update(payload).digest('hex')
  return sign
}

async function manualProbe({ env, apiKey, apiSecret }) {
  const API = env === 'MAINNET' ? BASE_MAINNET : BASE_TESTNET
  const ENV_LABEL = env === 'MAINNET' ? '[MAINNET]' : '[TESTNET]'
  const out = []

  const tsBefore = Date.now()
  let serverTime
  try {
    const t = await fetch(`${API}/v5/market/time`).then((r) => r.json())
    serverTime = Number(t?.result?.timeSecond ?? t.timeSecond ?? 0) * 1000 || Date.now()
  } catch {
    serverTime = Date.now()
  }
  const diff = tsBefore - serverTime
  out.push(`  Server time : ${new Date(serverTime).toISOString()}`)
  out.push(`  Local time  : ${new Date(tsBefore).toISOString()}`)
  out.push(`  Local diff  : ${diff} ms`)

  const recvWindow = '200000'
  const timestamp = String(Date.now() - Math.max(0, diff) - 500)
  const params = { accountType: 'UNIFIED', coin: '' }
  const sign = signParams({ apiKey, apiSecret, timestamp, recvWindow, params })
  const qs = new URLSearchParams(params).toString()
  const balResp = await fetch(`${API}/v5/account/wallet-balance?${qs}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': sign,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  })
  if (!balResp.ok) {
    const text = await balResp.text()
    out.push(`  ${ENV_LABEL} wallet-balance HTTP ${balResp.status}: ${text.slice(0, 300)}`)
    return out.join('\n')
  }
  const bal = await balResp.json()
  if (bal.retCode !== 0) {
    out.push(`  ${ENV_LABEL} wallet-balance retCode=${bal.retCode} retMsg=${bal.retMsg}`)
    return out.join('\n')
  }
  const list = bal.result?.list ?? []
  out.push('  Account wallets:')
  let total = 0
  for (const w of list) {
    const coins = (w.coin ?? []).filter((c) => parseFloat(c.walletBalance) > 0)
    out.push(`    • accountType=${w.accountType} totalEquity=${w.totalEquity ?? 'n/a'} totalWalletBalance=${w.totalWalletBalance ?? 'n/a'}`)
    for (const c of coins) {
      out.push(`      - ${c.coin}: wallet=${c.walletBalance}  available=${c.availableToWithdraw ?? c.availableBalance}  equity=${c.equity ?? 'n/a'}`)
      try { total += parseFloat(c.usdValue ?? 0) } catch {}
    }
  }
  out.push(`  ${ENV_LABEL} Estimated USD wallet total (from usdValue fields) ≈ ${total.toFixed(2)} USD`)
  out.push(`  ${ENV_LABEL} ✅ Bybit connection successful — signed probe verified.`)
  return out.join('\n')
}

export async function bybitProbe({ env, apiKey, apiSecret }) {
  try {
    const mod = await import('ccxt')
    const ccxt = mod.default ?? mod
    const ENV_LABEL = env === 'MAINNET' ? '[MAINNET]' : '[TESTNET]'
    const bybit = new ccxt.bybit({
      apiKey,
      secret: apiSecret,
      options: { adjustForTimeDifference: true, recvWindow: 200000, defaultType: 'unified' },
    })
    const out = []
    const srv = await bybit.fetchTime()
    const diff = Date.now() - srv
    out.push(`${ENV_LABEL} server_time=${new Date(srv).toISOString()} diff=${diff} ms`)
    try { await bybit.loadMarkets() } catch {}
    const bal = await bybit.fetchBalance()
    const total = Object.entries(bal.total ?? {}).reduce((s, [k, v]) => {
      if (typeof v === 'number' && k === 'USD') return s + v
      if (k === 'USDT' || k === 'USDC') return s + (Number(v) || 0)
      return s
    }, 0)
    out.push(`${ENV_LABEL} stablecoin wallet sum ≈ ${total.toFixed(2)} (USDT+USDC+USD)`)
    for (const k of Object.keys(bal.total ?? {})) {
      const v = bal.total[k]
      if (typeof v === 'number' && v > 0) {
        out.push(`  • ${k}: total=${bal.total[k]} free=${bal.free?.[k] ?? 'n/a'} used=${bal.used?.[k] ?? 'n/a'}`)
      }
    }
    out.push(`${ENV_LABEL} ✅ ccxt probe complete (read-only).`)
    return out.join('\n')
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module 'ccxt'/.test(e.message)) {
      return manualProbe({ env, apiKey, apiSecret })
    }
    throw e
  }
}
