import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * POST /api/auth/session  { token: string }
 * Sets the operator_session cookie used by middleware.ts for read access to
 * money/PII artifacts. DELETE clears it.
 *
 * Fail-closed: if OPERATOR_TOKEN is unset, this route refuses (503) rather than
 * minting a session that middleware would then trust.
 */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COOKIE = 'operator_session';

export async function POST(request: NextRequest) {
  const expected = process.env.OPERATOR_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'Operator authentication is not configured' },
      { status: 503 },
    );
  }

  let token = '';
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body?.token === 'string' ? body.token.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!token || !constantTimeEqual(token, expected)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, expected, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return response;
}
