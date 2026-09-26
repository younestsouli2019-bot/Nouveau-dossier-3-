import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const content = [
    'User-Agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Sitemap: https://www.realworldcerts.com/sitemap.xml',
    '',
  ].join('\n');

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
