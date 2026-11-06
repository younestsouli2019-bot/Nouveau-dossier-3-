import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = join(dirname(fileURLToPath(import.meta.url)), 'verify-core.js');
const manifestRel = 'scripts/guard/core-integrity.sha256manifest';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'verify-core-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/guard'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  copyFileSync(source, join(root, 'scripts/guard/verify-core.js'));
  writeFileSync(join(root, 'scripts/guard/core-files.txt'), `# list\none.txt\ntwo.txt\n${manifestRel}\n`);
  writeFileSync(join(root, 'one.txt'), 'one\r\nline\r\n');
  writeFileSync(join(root, 'two.txt'), 'two\n');
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/guard/verify-core.js'), ...args], {
    cwd: tmpdir(), encoding: 'utf8',
  });
  return { root, run, manifest: join(root, manifestRel) };
}

test('initializes the existing hash-first format and verifies normalized bytes from any cwd', t => {
  const { root, run, manifest } = fixture(t);
  assert.equal(run('-Init').status, 0);
  const text = readFileSync(manifest, 'utf8');
  const hash = createHash('sha256').update('one\nline\n').digest('hex');
  assert.match(text, new RegExp(`^${hash}  one\\.txt$`, 'm'));
  assert.match(text, /^0{64}  scripts\/guard\/core-integrity\.sha256manifest$/m);
  assert.equal(run().status, 0);
  writeFileSync(join(root, 'one.txt'), 'one\nline\n');
  assert.equal(run().status, 0);
});

test('reports every mismatch and missing file before failing', t => {
  const { root, run } = fixture(t);
  assert.equal(run('--init').status, 0);
  writeFileSync(join(root, 'one.txt'), 'changed\n');
  rmSync(join(root, 'two.txt'));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MISMATCH  one\.txt/);
  assert.match(result.stderr, /ERROR  two\.txt/);
  assert.match(result.stderr, /2 errors or mismatches/);
});

test('does not overwrite the manifest when any core file is missing', t => {
  const { root, run, manifest } = fixture(t);
  assert.equal(run('-Init').status, 0);
  const before = readFileSync(manifest, 'utf8');
  rmSync(join(root, 'one.txt'));
  rmSync(join(root, 'two.txt'));
  const result = run('-Init');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR  one\.txt/);
  assert.match(result.stderr, /ERROR  two\.txt/);
  assert.equal(readFileSync(manifest, 'utf8'), before);
});

test('fails closed on malformed or missing manifest and invalid lists or arguments', t => {
  const { root, run, manifest } = fixture(t);
  assert.equal(run().status, 1);
  assert.equal(run('-Init').status, 0);
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}invalid entry\n`);
  assert.match(run().stderr, /invalid or duplicate manifest entry/);
  writeFileSync(join(root, 'scripts/guard/core-files.txt'), '../escape\n');
  assert.equal(run().status, 1);
  assert.equal(run('--unknown').status, 1);
});
