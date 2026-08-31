import { NextResponse } from 'next/server';
import { getAccessToken, authedFetch } from '@/lib/attijari';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const token = await getAccessToken();
    return NextResponse.json({
      status: 'authenticated',
      tokenPreview: token.substring(0, 20) + '...',
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[Attijari] Error:', e);
    return NextResponse.json({ status: 'error', error: 'Internal server error' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const { endpoint, method = 'GET', body } = await request.json();

    if (!endpoint) {
      return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
    }

    const baseUrl = process.env.ATTIJARI_API_BASE || 'https://api.awsbx.dxp.delivery';
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

    const res = await authedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      data,
    });
  } catch (e: any) {
    console.error('[Attijari] Error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
