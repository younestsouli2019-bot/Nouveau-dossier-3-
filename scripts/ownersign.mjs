import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Wallet } from 'ethers';

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
  const outPath = path.resolve(args.out || path.join(process.cwd(), 'owner-signature.json'));
  const ignores = new Set(['owner-signature.json']);

  let pk = process.env.OWNER_PRIVATE_KEY;
  if ((!pk || pk.trim() === '') && args.keyfile) {
    const kf = path.resolve(args.keyfile);
    if (!fs.existsSync(kf)) {
      console.error('Keyfile not found at', kf);
      process.exit(2);
    }
    pk = fs.readFileSync(kf, 'utf8').trim();
  }
  if (!pk || pk.trim() === '') {
    console.error('OWNER_PRIVATE_KEY is not set and no --keyfile provided');
    process.exit(2);
  }

  const wallet = new Wallet(pk.trim());
  const files = collectFiles(rootPath, ignores);
  const fileEntries = files.map(f => ({
    path: path.relative(rootPath, f).replace(/\\/g, '/'),
    sha256: sha256File(f),
    size: fs.statSync(f).size
  }));

  const manifest = {
    root: rootPath,
    files: fileEntries,
    createdAt: new Date().toISOString()
  };
  const manifestSha256 = sha256JsonStable(manifest);
  const message = `sha256:${manifestSha256}`;
  const signature = await wallet.signMessage(message);

  const output = {
    algorithm: 'secp256k1-ethers-v6',
    signerAddress: wallet.address,
    manifestSha256,
    message,
    signature,
    manifest
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Signature written to', outPath);
  console.log('Signer', wallet.address);
  console.log('Files', fileEntries.length);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
