import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

export const dynamic = 'force-dynamic';

let running = false;

function resolveEngine(): { root: string; registry: string } | null {
  const cwd = process.cwd();
  const candidates = [
    { root: path.resolve(cwd, '..', '..'), rel: ['src', 'revenue-engines', 'registry.mjs'] },
    { root: path.resolve(cwd), rel: ['src', 'revenue-engines', 'registry.mjs'] },
  ];
  for (const c of candidates) {
    const p = path.join(c.root, ...c.rel);
    if (fs.existsSync(p)) return { root: c.root, registry: p };
  }
  return null;
}

function runEngine(root: string, registry: string): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [registry, 'run', 'rwc-social'],
      { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, output: stdout || '', error: String(stderr || error.message).slice(0, 2000) });
        } else {
          resolve({ ok: true, output: stdout });
        }
      }
    );
  });
}

export async function POST() {
  if (running) {
    return NextResponse.json({ ok: false, error: 'an engine run is already in progress' }, { status: 409 });
  }
  const engine = resolveEngine();
  if (!engine) {
    return NextResponse.json({ ok: false, error: 'rwc-social engine not found next to this app' }, { status: 500 });
  }
  running = true;
  try {
    const result = await runEngine(engine.root, engine.registry);
    let parsed: unknown = null;
    const lastBrace = result.output.lastIndexOf('}');
    if (lastBrace >= 0) {
      try {
        parsed = JSON.parse(result.output.slice(result.output.indexOf('{'), lastBrace + 1));
      } catch {
        parsed = result.output.trim();
      }
    }
    return NextResponse.json({ ok: result.ok, engine: 'rwc-social', root: engine.root, result: parsed, error: result.error });
  } finally {
    running = false;
  }
}
