import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const expiresDate = new Date();
  expiresDate.setFullYear(expiresDate.getFullYear() + 1);
  const expiresIso = expiresDate.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const content = [
    `Contact: mailto:security@realworldcerts.com`,
    `Expires: ${expiresIso}`,
    'Preferred-Languages: en, fr',
    'Canonical: https://www.realworldcerts.com/.well-known/security.txt',
    'Policy: https://www.realworldcerts.com/.well-known/security.txt',
    'Hiring: https://www.realworldcerts.com/careers',
    '',
  ].join('\n');

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
