import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const listPath = join(root, 'scripts/guard/core-files.txt');
const manifestRel = 'scripts/guard/core-integrity.sha256manifest';
const manifestPath = join(root, manifestRel);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '-Init' && arg !== '--init')) {
  console.error('Usage: node scripts/guard/verify-core.js [-Init|--init]');
  process.exit(1);
}
const init = args.length > 0;

function hashFile(file) {
  const bytes = readFileSync(file);
  const normalized = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    normalized[length++] = bytes[i];
  }
  return createHash('sha256').update(normalized.subarray(0, length)).digest('hex');
}

let files;
try {
  files = readFileSync(listPath, 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!files.length) throw new Error('CORE list is empty');
  if (new Set(files).size !== files.length || files.some(file =>
    isAbsolute(file) || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')
  )) throw new Error('CORE list contains duplicate or invalid paths');
} catch (error) {
  console.error(`[verify-core] FAIL: cannot read canonical CORE list: ${error.message}`);
  process.exit(1);
}

let failures = 0;
const expected = new Map();
if (!init) {
  try {
    const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([a-fA-F0-9]{64})\s+(.+?)\s*$/.exec(line);
      if (!match || expected.has(match[2])) {
        console.error(`[verify-core] invalid or duplicate manifest entry at line ${index + 1}`);
        failures++;
        continue;
      }
      expected.set(match[2], match[1].toLowerCase());
    }
  } catch (error) {
    console.error(`[verify-core] cannot read manifest: ${error.message}`);
    failures++;
  }
}

const hashes = new Map();
for (const file of files) {
  try {
    if (!init && file === manifestRel) {
      readFileSync(join(root, file));
      continue;
    }
    let actual;
    if (init && file === manifestRel) {
      try {
        actual = hashFile(join(root, file));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        actual = '0'.repeat(64);
      }
    } else {
      actual = hashFile(join(root, file));
    }
    hashes.set(file, actual);
    if (!init && expected.get(file) !== actual) {
      console.error(`MISMATCH  ${file}  want=${expected.get(file) ?? '(missing)'}  actual=${actual}`);
      failures++;
    }
  } catch (error) {
    console.error(`ERROR  ${file}  ${error.message}`);
    failures++;
  }
}

if (failures) {
  console.error(`[verify-core] FAIL -- ${failures} errors or mismatches.`);
  if (!init) console.error('For intentional changes, run: node scripts/guard/verify-core.js -Init');
  process.exit(1);
}

if (init) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    `# swarm-core integrity manifest — generated ${timestamp}`,
    `# files=${files.length}  algorithm=SHA-256  encoding=hex  path-base=repo-root`,
    '# Re-generate with: node scripts/guard/verify-core.js -Init',
    '# Protect this file from write via: attrib +R scripts/guard/core-integrity.sha256manifest',
    ...files.map(file => `${hashes.get(file)}  ${file}`),
  ];
  try {
    writeFileSync(manifestPath, `${lines.join('\n')}\n`, 'utf8');
    console.log(`[verify-core] wrote manifest: ${manifestPath}  entries=${files.length}`);
  } catch (error) {
    console.error(`[verify-core] FAIL: cannot write manifest: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log(`[verify-core] PASS -- ${files.length} CORE files, ALL hashes match.`);
}
