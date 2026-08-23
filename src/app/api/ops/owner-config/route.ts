import { NextResponse } from 'next/server'
import { isOwnerConfigured, getOwnerName, getOwnerEmail, getConfiguredWallets, SUPPORTED_NETWORKS } from '@/lib/owner-config'

export async function GET() {
  try {
  const configured = isOwnerConfigured()
  const wallets = getConfiguredWallets()

  const walletStatus = SUPPORTED_NETWORKS.map((network) => ({
    network,
    configured: network in wallets,
    address: wallets[network] ? `${wallets[network].slice(0, 8)}...${wallets[network].slice(-6)}` : null,
  }))

  return NextResponse.json({
    owner: {
      configured,
      name: configured ? getOwnerName() : null,
      email: configured ? getOwnerEmail().replace(/(.{2})(.*)(@.*)/, '$1***$3') : null,
    },
    wallets: walletStatus,
    networksConfigured: Object.keys(wallets).length,
    networksTotal: SUPPORTED_NETWORKS.length,
  })
  } catch (error) {
    console.error('[/api/ops/owner-config] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}