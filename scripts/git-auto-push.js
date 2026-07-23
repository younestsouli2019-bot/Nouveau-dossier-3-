#!/usr/bin/env node
/**
 * Git Auto-Push
 * 
 * Monitors source files for changes, auto-commits and pushes to GitHub.
 * Uses fresh repo approach (main repo too large for direct push).
 * 
 * Usage:
 *   node git-auto-push.js              # One-time check+push
 *   node git-auto-push.js --daemon     # Check every 30 minutes
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const FRESH_REPO = 'C:\\Users\\Dell\\AppData\\Local\\Temp\\opencode\\fresh-repo';

// Load PAT from .env file (not committed)
let PAT = process.env.GITHUB_PAT;
if (!PAT) {
  try {
    const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const match = envFile.match(/GITHUB_PAT=(.+)/);
    if (match) PAT = match[1].trim();
  } catch {}
}
if (!PAT) { console.error('GITHUB_PAT not found in env or .env'); process.exit(1); }
const REMOTE = `https://younestsouli2019-bot:${PAT}@github.com/younestsouli2019-bot/Nouveau-dossier-3-.git`;

const WATCH_DIRS = ['scripts', 'exports'];
const WATCH_EXTS = ['.js', '.mjs', '.json'];

function getChangedFiles() {
  try {
    const output = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    return output.split('\n').filter(l => l.trim()).map(l => l.substring(3));
  } catch { return []; }
}

function isWatched(filePath) {
  const ext = path.extname(filePath);
  if (!WATCH_EXTS.includes(ext)) return false;
  return WATCH_DIRS.some(dir => filePath.startsWith(dir + '\\') || filePath.startsWith(dir + '/'));
}

function ensureFreshRepo() {
  if (!fs.existsSync(path.join(FRESH_REPO, '.git'))) {
    console.log('Cloning fresh repo...');
    execSync(`git clone --depth 1 "${REMOTE}" "${FRESH_REPO}"`, { timeout: 120000, stdio: 'pipe' });
  }
  // Update remote URL with PAT
  execSync(`git remote set-url origin "${REMOTE}"`, { cwd: FRESH_REPO, stdio: 'pipe' });
}

function pushChanges(changedFiles) {
  console.log(`Pushing ${changedFiles.length} changed files...`);

  // Copy changed files to fresh repo
  for (const file of changedFiles) {
    const src = path.join(ROOT, file);
    const dst = path.join(FRESH_REPO, file);
    const dstDir = path.dirname(dst);
    
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, dst); } catch(e) { console.log(`Copy failed: ${file}: ${e.message}`); }
    }
  }

  // Stage and commit
  try {
    execSync('git add -A', { cwd: FRESH_REPO, stdio: 'pipe', timeout: 30000 });
    
    const status = execSync('git status --porcelain', { cwd: FRESH_REPO, encoding: 'utf8', timeout: 10000 });
    if (!status.trim()) {
      console.log('No changes to commit');
      return true;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    execSync(`git commit -m "auto-push: ${changedFiles.length} files updated [${timestamp}]"`, {
      cwd: FRESH_REPO, stdio: 'pipe', timeout: 30000
    });

    execSync('git push origin main', { cwd: FRESH_REPO, stdio: 'pipe', timeout: 60000 });
    console.log('Pushed successfully');
    return true;
  } catch(e) {
    console.log('Push failed:', e.message);
    return false;
  }
}

function main() {
  const isDaemon = process.argv.includes('--daemon');

  if (isDaemon) {
    console.log('=== Git Auto-Push (Daemon) ===');
    console.log('Checking every 30 minutes.\n');

    setInterval(() => {
      try {
        const changed = getChangedFiles().filter(isWatched);
        if (changed.length > 0) {
          console.log(`\n[${new Date().toISOString()}] ${changed.length} files changed`);
          ensureFreshRepo();
          pushChanges(changed);
        } else {
          console.log(`[${new Date().toISOString()}] No changes`);
        }
      } catch(e) {
        console.log('Error:', e.message);
      }
    }, 1800000);
  } else {
    const changed = getChangedFiles().filter(isWatched);
    if (changed.length > 0) {
      ensureFreshRepo();
      pushChanges(changed);
    } else {
      console.log('No changes to push');
    }
  }
}

main();
