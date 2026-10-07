#!/usr/bin/env node
// audit-tracked-sensitive — inventaire pre-scrub des fichiers
// trackes (git ls-files) par noms suspects. Ecrit NDJSON.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SENSITIVE_PATTERNS = [
    { tier: 3, re: /(^|\/)\.swarm\/.*/,             name: '.swarm runtime config (fuite 9ad2972)' },
    { tier: 3, re: /(^|\/)\.keys\/.*/,              name: '.keys local lockbox DPAPI' },
    { tier: 3, re: /(^|\/)\.env(\..+)?$/,            name: 'env files' },
    { tier: 3, re: /\.pem$|\.key$|\.crt$/,           name: 'x509/private key files' },
    { tier: 3, re: /owner.*hands.*free.*\.ps1$/,      name: 'start-owner hands free ps1 runtime' },
    { tier: 3, re: /lockbox.*\.enc(\.bak[-_]?\d*)?$/, name: 'autorotate lockbox encrypted' },
    { tier: 2, re: /CREDS\.txt$/,                     name: 'legacy CREDS.txt' },
    { tier: 2, re: /signature/,                       name: 'signature directory / file' },
    { tier: 2, re: /bank-config\.json$/,              name: 'bank-config local' },
    { tier: 2, re: /offline-store\.json$/,            name: 'base44 offline store materialized' },
    { tier: 2, re: /_cred\.xml$|\.ps1\.xml$/,         name: 'PS credential export' },
    { tier: 1, re: /\.dpapi$|\.aesgcm$|\.aesgcm\.dat$/, name: 'wrapped blobs (tier=review)' },
    { tier: 1, re: /materialized\.csv$/,              name: 'derived CSV cached (review)' },
];

function main() {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    const rows = [];
    for (const p of tracked) {
        let bestTier = 0;
        let bestRule = '';
        for (const rule of SENSITIVE_PATTERNS) {
            if (rule.re.test(p) && rule.tier > bestTier) { bestTier = rule.tier; bestRule = rule.name; }
        }
        if (bestTier === 0) continue;
        const tierName = bestTier === 3 ? 'T3_PROHIBITED_NAME_LIKE_SECRET'
                     : bestTier === 2 ? 'T2_SECRET_CANDIDATE_REVIEW'
                     : 'T1_REVIEW_DERIVED_WRAPPED';
        let blob = '';
        let sizeB = -1;
        try {
            const ls = execSync(`git ls-files -s -- "${p.replace(/"/g,'\\"')}"`, { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/);
            if (ls[1]) blob = ls[1];
            if (blob) {
                try {
                    const raw = execSync(`git cat-file -s ${blob}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
                    sizeB = parseInt(raw, 10);
                    if (!Number.isFinite(sizeB)) sizeB = -1;
                } catch { sizeB = -1; }
            }
        } catch {}
        rows.push({
            path: p,
            tier: tierName,
            rule_name: bestRule,
            blob,
            size_bytes: sizeB,
            tracked: true,
            catalogued_at: new Date().toISOString(),
        });
    }
    const outFile = process.argv.find(a => a.startsWith('--out='))?.split('=')[1]
        ?? resolve(ROOT, 'data', 'out', 'audit', 'tracked-sensitive-catalog.ndjson');
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
    const counts = rows.reduce((m, r) => { m[r.tier] = (m[r.tier] || 0) + 1; return m; }, {});
    console.log(JSON.stringify({ total: rows.length, counts, out_file: outFile }, null, 2));
    process.exit(0);
}
main();
