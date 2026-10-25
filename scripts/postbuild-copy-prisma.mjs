import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

if (!fs.existsSync(STANDALONE)) {
  console.error('[postbuild] .next/standalone not found');
  process.exit(1);
}

function copyRecursive(src, dest, label) {
  if (!fs.existsSync(src)) return;
  try {
    fs.cpSync(src, dest, { recursive: true, dereferenceSymlinks: true });
    console.log(`[postbuild] OK: ${label}`);
  } catch (err) { console.error(`[postbuild] FAIL: ${label}: ${err.message}`); process.exit(2); }
}

const PRISMA_TARGET = path.join(STANDALONE, 'node_modules', '@prisma');
fs.mkdirSync(PRISMA_TARGET, { recursive: true });
copyRecursive(path.join(ROOT, 'node_modules', '@prisma', 'client'), path.join(PRISMA_TARGET, 'client'), '@prisma/client');
copyRecursive(path.join(ROOT, 'node_modules', '@prisma', 'engines'), path.join(PRISMA_TARGET, 'engines'), '@prisma/engines');
copyRecursive(path.join(ROOT, 'node_modules', 'prisma'), path.join(STANDALONE, 'node_modules', 'prisma'), 'prisma');
copyRecursive(path.join(ROOT, 'prisma'), path.join(STANDALONE, 'prisma'), 'prisma schema');
copyRecursive(path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static'), '.next/static');
copyRecursive(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'), 'public/');

// CRITICAL: Remove .next/node_modules symlinks that break Space-Z tar packaging
const nextNodeModules = path.join(ROOT, '.next', 'node_modules');
if (fs.existsSync(nextNodeModules)) {
  fs.rmSync(nextNodeModules, { recursive: true, force: true });
  console.log('[postbuild] OK: .next/node_modules removed (fixes tar failure)');
}

console.log('[postbuild] standalone tree ready for tar packaging.');
