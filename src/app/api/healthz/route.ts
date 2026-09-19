import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getPackageVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getGitCommit(): string {
  try {
    const commit = execSync('git rev-parse HEAD', { timeout: 2000, encoding: 'utf8' }).trim();
    return commit;
  } catch {
    return 'unknown';
  }
}

async function checkDbConnected(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const result = await db.$queryRawUnsafe<{ ok: number }[]>(
        'SELECT 1 AS ok',
      );
      clearTimeout(timeout);
      const ok = Array.isArray(result) && result.length > 0 && result[0].ok === 1;
      return Boolean(ok);
    } catch (err) {
      clearTimeout(timeout);
      void err;
      return false;
    }
  } catch {
    return false;
  }
}

export async function GET() {
  const [version, commit, dbConnected] = await Promise.all([
    Promise.resolve(getPackageVersion()),
    Promise.resolve(getGitCommit()),
    checkDbConnected(),
  ]);

  return NextResponse.json(
    {
      ok: true,
      status: 'healthy',
      version,
      timestamp: Date.now(),
      uptime: process.uptime(),
      commit,
      node_version: process.version,
      db_connected: dbConnected,
      prisma_client: 'generated',
    },
    { status: 200 },
  );
}
