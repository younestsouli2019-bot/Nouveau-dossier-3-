import fs from 'fs'
import path from 'path'

function val(name) {
  return String(process.env[name] ?? '').trim().toLowerCase()
}

export function getRoutesStatus() {
  const bunker = val('BUNKER_MODE') === 'true'
  const payoneerMode = val('PAYONEER_MODE')
  const payoneerOpen = payoneerMode.includes('receive') && !bunker
  const paypalDisabled = val('PAYPAL_DISABLED') === 'true'
  const paypalOpen = !paypalDisabled && !bunker
  const bankEnabled = val('BANK_INTEGRATION_ENABLED') === 'true'
  const bankOpen = bankEnabled
  const cryptoWithdrawEnable = val('CRYPTO_WITHDRAW_ENABLE') === 'true'
  const cryptoOpen = cryptoWithdrawEnable && !bunker
  const out = {
    created_at: new Date().toISOString(),
    bunker_mode: bunker,
    payoneer_open: payoneerOpen,
    paypal_open: paypalOpen,
    bank_open: bankOpen,
    crypto_open: cryptoOpen
  }
  return out
}

export function writeRoutesStatus(filePath = 'data/notifications/routes-status.json') {
  const status = getRoutesStatus()
  const p = path.resolve(filePath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(status, null, 2))
  return p
}
