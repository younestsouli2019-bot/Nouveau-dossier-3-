// ——— GitHub App installation token minting ———
// Mirrors the repo's convention (Node crypto, no new deps).
// The App private key is read from env and NEVER written to source.
// Env needed:
//   GITHUB_APP_ID            (e.g. 4747326)
//   GITHUB_APP_CLIENT_ID     (e.g. Iv23liTNsivwv1VombpX)
//   GITHUB_APP_INSTALLATION_ID
//   GITHUB_APP_PRIVATE_KEY   (PEM from GitHub UI, single line with \n escaped)
// —————————————————————————————————————————————————————

import { createSign } from 'crypto'

const APP_ID = process.env.GITHUB_APP_ID || ''
const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID || ''
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || ''

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function getPrivateKey(): string {
  const key = process.env.GITHUB_APP_PRIVATE_KEY || ''
  if (!key) throw new Error('GITHUB_APP_PRIVATE_KEY is not set')
  // Env values often arrive with literal \n escapes; normalize.
  return key.replace(/\\n/g, '\n').trim()
}

/**
 * Sign a short-lived RS256 JWT (iat/exp) used to authenticate as the GitHub App.
 */
export function appJwt(): string {
  if (!APP_ID) throw new Error('GITHUB_APP_ID is not set')
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 600, iss: APP_ID }
  const signingInput =
    base64url(Buffer.from(JSON.stringify(header))) +
    '.' +
    base64url(Buffer.from(JSON.stringify(payload)))
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(getPrivateKey())
  return signingInput + '.' + base64url(signature)
}

async function ghJson(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (init?.token) headers['Authorization'] = `Bearer ${init.token}`
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers,
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

/**
 * Resolve the installation access token for this App's installation.
 * Requires GITHUB_APP_INSTALLATION_ID.
 */
export async function getInstallationToken(): Promise<string> {
  if (!INSTALLATION_ID) throw new Error('GITHUB_APP_INSTALLATION_ID is not set')
  const { ok, status, body } = await ghJson(
    `/app/installations/${INSTALLATION_ID}/access_tokens`,
    { method: 'POST', token: appJwt() },
  )
  if (!ok) {
    throw new Error(
      `GitHub token exchange failed (${status}): ${JSON.stringify(body)}`,
    )
  }
  const data = body as { token: string }
  return data.token
}

/**
 * List the installations this App can act on (used to discover the correct
 * installation ID). Returns installation objects with `owner`, `id`, etc.
 */
export async function listInstallations(): Promise<unknown[]> {
  const { ok, status, body } = await ghJson('/app/installations', {
    token: appJwt(),
  })
  if (!ok) {
    throw new Error(
      `GitHub installations failed (${status}): ${JSON.stringify(body)}`,
    )
  }
  return body as unknown[]
}

export const githubApp = {
  id: APP_ID || '4747326',
  clientId: CLIENT_ID || 'Iv23liTNsivwv1VombpX',
  installationId: INSTALLATION_ID,
}
