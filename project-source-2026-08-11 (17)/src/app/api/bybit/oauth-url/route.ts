import { NextRequest, NextResponse } from 'next/server'
import {
  buildAuthzUrl,
  generateChallenge,
  generateState,
  generateVerifier,
  saveSession,
  type BybitEnv,
} from '@/lib/bybit-oauth'

export const runtime = 'nodejs'

interface Resp {
  ok: true
  authzUrl: string
  state: string
  env: BybitEnv
  clientId: string
  scope: string
  pkce: { challenge: string; method: 'S256' }
  envLabel: '[MAINNET]' | '[TESTNET]'
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      env?: BybitEnv | string
      confirmTestnet?: string
    }
    let env: BybitEnv = 'MAINNET'
    if (body.env === 'TESTNET') {
      if (body.confirmTestnet !== 'CONFIRM') {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Switching to TESTNET requires user to type exact word CONFIRM in confirmTestnet field (safety rule).',
          },
          { status: 400 },
        )
      }
      env = 'TESTNET'
    }
    const verifier = generateVerifier()
    const challenge = generateChallenge(verifier)
    const state = generateState()
    saveSession({
      verifier,
      challenge,
      state,
      env,
      createdAt: new Date().toISOString(),
    })
    const authzUrl = buildAuthzUrl(env, state, challenge)
    const json: Resp = {
      ok: true,
      authzUrl,
      state,
      env,
      clientId: 'ai-agent',
      scope: 'ai-account',
      pkce: { challenge, method: 'S256' },
      envLabel: env === 'MAINNET' ? '[MAINNET]' : '[TESTNET]',
    }
    const resp = NextResponse.json(json, { status: 200 })
    resp.cookies.set({
      name: 'bybit_oauth_state',
      value: state,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15,
    })
    resp.cookies.set({
      name: 'bybit_oauth_verifier',
      value: verifier,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15,
    })
    resp.cookies.set({
      name: 'bybit_oauth_env',
      value: env,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15,
    })
    return resp
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    )
  }
}
