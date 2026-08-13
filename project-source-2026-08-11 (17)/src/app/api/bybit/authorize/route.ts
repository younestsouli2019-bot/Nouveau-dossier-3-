import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  fetchAiAccounts,
  maskApiKey,
  maskApiSecret,
  persistCredsToVault,
  popSession,
  type BybitEnv,
  type BybitAiAccountCred,
  type PersistedCred,
} from '@/lib/bybit-oauth'
import { tryGetOwnerEmail, tryGetOwnerName } from '@/lib/owner-config'

export const runtime = 'nodejs'

interface AuthorizeInput {
  accessToken?: string
  code?: string
  state?: string
  env?: BybitEnv | string
  codeVerifier?: string
  selectedIndex?: number
}

export async function POST(req: NextRequest) {
  const ownerName = tryGetOwnerName() ?? 'SWARM OWNER'
  const ownerEmail = tryGetOwnerEmail() ?? 'swarm@local'
  let body: AuthorizeInput = {} as AuthorizeInput
  try {
    body = (await req.json().catch(() => ({}))) as AuthorizeInput
    const state =
      body.state ??
      req.cookies.get('bybit_oauth_state')?.value ??
      null
    const env =
      (body.env as BybitEnv) ??
      (req.cookies.get('bybit_oauth_env')?.value as BybitEnv) ??
      'MAINNET'
    const verifier =
      body.codeVerifier ?? req.cookies.get('bybit_oauth_verifier')?.value

    const session = state ? popSession(state) : null
    const effectiveVerifier = verifier ?? session?.verifier
    const effectiveEnv = session?.env ?? env

    if (effectiveEnv !== 'MAINNET' && effectiveEnv !== 'TESTNET') {
      return NextResponse.json(
        { ok: false, error: `Invalid env ${effectiveEnv as string}` },
        { status: 400 },
      )
    }

    let accessToken: string | undefined = body.accessToken
    if (!accessToken && body.code && effectiveVerifier) {
      const base =
        effectiveEnv === 'MAINNET'
          ? 'https://api2.bybit.com'
          : 'https://api2-testnet.bybit.com'
      const tok = await fetch(`${base}/oauth/v1/public/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'ai-agent',
          grant_type: 'authorization_code',
          code: body.code,
          code_verifier: effectiveVerifier,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`token HTTP ${r.status}: ${await r.text()}`)
        return r.json() as Promise<{ access_token: string }>
      })
      accessToken = tok.access_token
    }
    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Missing access_token (cloud-agent path) OR code+verifier (local-agent path).',
        },
        { status: 400 },
      )
    }

    const accounts = await fetchAiAccounts(effectiveEnv, accessToken)
    if (!accounts.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No AI sub-accounts were returned. Please create an AI sub-account on Bybit first (up to 5 per main account), then re-authorize.',
          accounts: [],
        },
        { status: 400 },
      )
    }

    const selectedIdx =
      typeof body.selectedIndex === 'number' &&
      body.selectedIndex >= 0 &&
      body.selectedIndex < accounts.length
        ? body.selectedIndex
        : 0
    const selected: BybitAiAccountCred = accounts[selectedIdx]

    const persisted: PersistedCred = persistCredsToVault({
      env: effectiveEnv,
      subAccountId: selected.subAccountId,
      subAccountName: selected.subAccountName,
      apiKey: selected.apiKey,
      apiSecret: selected.apiSecret,
      passphrase: selected.passphrase,
      ownerName,
      ownerEmail,
    })

    let existing = await db.ownerAccount.findFirst({
      where: {
        accountType: 'l2_crypto',
        bankName: 'Bybit',
        walletAddress: persisted.subAccountId,
      },
    })
    if (!existing) {
      existing = await db.ownerAccount.create({
        data: {
          label: persisted.accountLabel,
          accountType: 'l2_crypto',
          isActive: true,
          isPrimary: accounts.length === 1,
          purposes: 'crypto_settlement,trading,general',
          accountHolder: ownerName,
          accountNumber: persisted.vaultKeyApiKey,
          accountNumberLast: maskApiKey(selected.apiKey).slice(-4),
          bankName: 'Bybit',
          swiftCode: effectiveEnv,
          countryCode: 'AI',
          currency: 'USDT',
          network: effectiveEnv,
          walletAddress: persisted.subAccountId,
          walletAddressShort: persisted.maskedApiKey,
          preferredToken: 'USDT',
          notes: JSON.stringify({
            origin: 'bybit-oauth',
            env: effectiveEnv,
            subAccountName: persisted.subAccountName ?? null,
            vaultKeyApiKey: persisted.vaultKeyApiKey,
            vaultKeyApiSecret: persisted.vaultKeyApiSecret,
            permissions: selected.permissions ?? null,
            readOnly: selected.readOnly ?? null,
            authorizedAt: new Date().toISOString(),
          }),
          verifiedAt: new Date(),
          lastUsedAt: new Date(),
        },
      })
    } else {
      existing = await db.ownerAccount.update({
        where: { id: existing.id },
        data: {
          label: persisted.accountLabel,
          isActive: true,
          walletAddressShort: persisted.maskedApiKey,
          notes: JSON.stringify({
            origin: 'bybit-oauth',
            env: effectiveEnv,
            subAccountName: persisted.subAccountName ?? null,
            vaultKeyApiKey: persisted.vaultKeyApiKey,
            vaultKeyApiSecret: persisted.vaultKeyApiSecret,
            permissions: selected.permissions ?? null,
            readOnly: selected.readOnly ?? null,
            authorizedAt: new Date().toISOString(),
          }),
          verifiedAt: new Date(),
          lastUsedAt: new Date(),
        },
      })
    }

    const envLabel: '[MAINNET]' | '[TESTNET]' =
      effectiveEnv === 'MAINNET' ? '[MAINNET]' : '[TESTNET]'

    return NextResponse.json(
      {
        ok: true,
        envLabel,
        env: effectiveEnv,
        owner: { name: ownerName, email: ownerEmail },
        subAccountsAvailable: accounts.map((a) => ({
          subAccountId: a.subAccountId,
          subAccountName: a.subAccountName ?? null,
          maskedApiKey: maskApiKey(a.apiKey),
          maskedApiSecret: maskApiSecret(a.apiSecret),
        })),
        selected: {
          subAccountId: persisted.subAccountId,
          subAccountName: persisted.subAccountName ?? null,
          maskedApiKey: persisted.maskedApiKey,
          maskedApiSecret: persisted.maskedApiSecret,
          accountLabel: persisted.accountLabel,
          vaultKeyApiKey: persisted.vaultKeyApiKey,
          ownerAccountId: existing.id,
        },
        safety: {
          defaultTransferLimitUsdt: 5000,
          withdrawalScope: 'NOT included — AI sub-account key cannot withdraw per OAuth scope',
          mainAccountScope: 'NOT included — AI sub-account isolated per Bybit scope',
          revokeInstruction:
            'Delete the AI sub-account on Bybit.com at any time to immediately revoke all keys.',
        },
      },
      { status: 200 },
    )
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? String(e),
        envLabel:
          ((body.env ?? 'MAINNET') === 'MAINNET'
            ? '[MAINNET]'
            : '[TESTNET]') as '[MAINNET]' | '[TESTNET]',
      },
      { status: 500 },
    )
  }
}
