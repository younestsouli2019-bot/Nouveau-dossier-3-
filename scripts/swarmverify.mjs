import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { verifyMessage } from 'ethers';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    } else {
      args._ = args._ || [];
      args._.push(a);
    }
  }
  return args;
}

function collectFiles(root, ignores) {
  const results = [];
  function walk(current) {
    const rel = path.relative(root, current);
    const base = path.basename(current);
    if (ignores.has(base) || rel.startsWith('node_modules') || rel.startsWith('.git')) return;
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current);
      for (const e of entries) walk(path.join(current, e));
    } else if (stat.isFile()) {
      results.push(current);
    }
  }
  walk(root);
  return results.sort((a, b) => a.localeCompare(b));
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  const h = crypto.createHash('sha256');
  h.update(data);
  return h.digest('hex');
}

function sha256JsonStable(obj) {
  const json = JSON.stringify(obj);
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(json, 'utf8'));
  return h.digest('hex');
}

async function main() {
  const args = parseArgs(process.argv);
  const rootPath = path.resolve(args.path || '.');
  const sigPath = path.resolve(args.sig || path.join(process.cwd(), 'owner-signature.json'));
  const ignores = new Set(['owner-signature.json']);

  if (!fs.existsSync(sigPath)) {
    console.error('Signature file not found at', sigPath);
    process.exit(2);
  }

  const payload = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  const files = collectFiles(rootPath, ignores);
  const fileEntries = files.map(f => ({
    path: path.relative(rootPath, f).replace(/\\/g, '/'),
    sha256: sha256File(f),
    size: fs.statSync(f).size
  }));
  const manifest = {
    root: rootPath,
    files: fileEntries,
    createdAt: payload.manifest.createdAt
  };

  const manifestSha256 = sha256JsonStable(manifest);
  const message = `sha256:${manifestSha256}`;

  if (manifestSha256 !== payload.manifestSha256) {
    console.error('Manifest hash mismatch');
    process.exit(3);
  }

  if (message !== payload.message) {
    console.error('Signed message mismatch');
    process.exit(4);
  }

  const recovered = verifyMessage(message, payload.signature);
  if (recovered.toLowerCase() !== payload.signerAddress.toLowerCase()) {
    console.error('Signature invalid for signer address');
    process.exit(5);
  }

  console.log('Verification OK');
  console.log('Signer', payload.signerAddress);
  console.log('Files', fileEntries.length);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});

