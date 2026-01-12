import 'dotenv/config'
import { CryptoGateway } from '../src/financial/gateways/CryptoGateway.mjs'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true
    args[k] = v
    if (v !== true) i++
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  const provider = String(args.provider || process.env.MICRO_PROVIDER || 'bybit').toLowerCase()
  const amount = Number(args.amount || process.env.MICRO_AMOUNT_USDT || '3.7')
  const network = String(args.network || process.env.CRYPTO_NETWORK || 'TON').toUpperCase()
  const dest =
    args.address ||
    process.env.OWNER_CRYPTO_TON ||
    process.env.TRUST_WALLET_USDT_TON ||
    process.env.BYBIT_USDT_TON ||
    process.env.OWNER_CRYPTO_BEP20 ||
    process.env.TRUST_WALLET_ADDRESS
  if (!dest || !amount || !(amount > 0)) {
    console.log(JSON.stringify({ ok: false, error: 'missing_destination_or_amount' }))
    return
  }
  const gw = new CryptoGateway()
  const tx = [{ amount, currency: 'USDT', destination: dest, network }]
  const res = await gw.executeTransfer(tx, { provider })
  console.log(JSON.stringify({ ok: true, provider, network, dest, result: res }))
}

main()
