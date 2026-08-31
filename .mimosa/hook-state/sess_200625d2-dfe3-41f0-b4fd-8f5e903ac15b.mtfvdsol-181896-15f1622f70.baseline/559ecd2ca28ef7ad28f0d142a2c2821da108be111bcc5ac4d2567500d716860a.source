import https from 'https';
import fs from 'fs';
import path from 'path';

const TOKEN_HOST = 'api.awsbx.dxp.delivery';
const TOKEN_PATH = '/as/token.oauth2';
const TOKEN_EXPIRY_BUFFER = 300;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

function getCredentials() {
  return {
    clientId: process.env.ATTIJARI_CLIENT_ID || '',
    clientSecret: process.env.ATTIJARI_CLIENT_SECRET || '',
    scope: process.env.ATTIJARI_SCOPE || 'ais pis',
    qWacCertPath: process.env.ATTIJARI_QWAC_CERT || path.join(process.cwd(), 'certs', 'qwac.pem'),
    qWacKeyPath: process.env.ATTIJARI_QWAC_KEY || path.join(process.cwd(), 'certs', 'qwac-key.pem'),
  };
}

function isTokenValid(): boolean {
  if (!cachedToken) return false;
  return Date.now() < cachedToken.expiresAt - TOKEN_EXPIRY_BUFFER * 1000;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && isTokenValid()) {
    return cachedToken!.token;
  }

  const creds = getCredentials();

  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Missing ATTIJARI_CLIENT_ID or ATTIJARI_CLIENT_SECRET env vars');
  }

  const hasCerts = fs.existsSync(creds.qWacCertPath) && fs.existsSync(creds.qWacKeyPath);

  if (hasCerts) {
    return getTokenWithMTLS(creds);
  }

  return getTokenWithoutMTLS(creds);
}

async function getTokenWithMTLS(creds: {
  clientId: string;
  clientSecret: string;
  scope: string;
  qWacCertPath: string;
  qWacKeyPath: string;
}): Promise<string> {
  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: creds.scope,
  }).toString();

  const cert = fs.readFileSync(creds.qWacCertPath);
  const key = fs.readFileSync(creds.qWacKeyPath);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: TOKEN_HOST,
        port: 443,
        path: TOKEN_PATH,
        method: 'POST',
        cert,
        key,
        rejectUnauthorized: true,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Token request failed (${res.statusCode}): ${data}`));
            return;
          }
          try {
            const parsed: TokenResponse = JSON.parse(data);
            cachedToken = {
              token: parsed.access_token,
              expiresAt: Date.now() + parsed.expires_in * 1000,
            };
            resolve(parsed.access_token);
          } catch (e: any) {
            reject(new Error(`Token parse error: ${e.message}. Raw: ${data.substring(0, 200)}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getTokenWithoutMTLS(creds: {
  clientId: string;
  clientSecret: string;
  scope: string;
}): Promise<string> {
  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: creds.scope,
  }).toString();

  const res = await fetch(`https://${TOKEN_HOST}${TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok || !text) {
    throw new Error(`Token request failed (${res.status}): ${text || 'empty response'}`);
  }

  const parsed: TokenResponse = JSON.parse(text);
  cachedToken = {
    token: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  return parsed.access_token;
}

export async function authedFetch(
  url: string,
  options: RequestInit = {},
  attempt = 1
): Promise<Response> {
  const token = await getAccessToken();

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && attempt <= 2) {
    const freshToken = await getAccessToken(true);
    return authedFetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${freshToken}`,
      },
    }, attempt + 1);
  }

  return res;
}
