#!/usr/bin/env node
/**
 * WhatsApp Session Backup
 * 
 * Backs up .wwebjs_auth2 session to exports/wa-session-backup/.
 * Keeps last 5 backups. Handles locked files gracefully.
 * 
 * Usage:
 *   node wa-session-backup.js              # One-time backup
 *   node wa-session-backup.js --daemon     # Backup every hour
 */

const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const SESSION_DIR = path.join(ROOT, 'swarm-wa', '.wwebjs_auth2', 'session');
const BACKUP_DIR = path.join(ROOT, 'exports', 'wa-session-backup');
const MAX_BACKUPS = 5;

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        if (e.code === 'EBUSY') {
          // File locked — read and write instead
          try {
            const data = fs.readFileSync(srcPath);
            fs.writeFileSync(destPath, data);
          } catch {}
        }
      }
    }
  }
}

function backup() {
  if (!fs.existsSync(SESSION_DIR)) {
    console.log('Session directory not found:', SESSION_DIR);
    return false;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `session-${timestamp}`);

  console.log(`Backing up session to ${backupPath}...`);
  copyDirSync(SESSION_DIR, backupPath);

  // Get backup size
  let size = 0;
  function getSize(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) getSize(p);
      else try { size += fs.statSync(p).size; } catch {}
    }
  }
  getSize(backupPath);

  console.log(`Backup complete: ${(size / 1024 / 1024).toFixed(1)} MB`);

  // Cleanup old backups
  if (fs.existsSync(BACKUP_DIR)) {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(d => d.startsWith('session-'))
      .sort()
      .reverse();
    
    if (backups.length > MAX_BACKUPS) {
      for (const old of backups.slice(MAX_BACKUPS)) {
        const oldPath = path.join(BACKUP_DIR, old);
        try {
          fs.rmSync(oldPath, { recursive: true, force: true });
          console.log(`Removed old backup: ${old}`);
        } catch {}
      }
    }
  }

  return true;
}

async function main() {
  const isDaemon = process.argv.includes('--daemon');

  if (isDaemon) {
    console.log('=== WhatsApp Session Backup (Daemon) ===');
    console.log('Backing up every hour. Ctrl+C to stop.\n');

    while (true) {
      try { backup(); } catch(e) { console.log('Backup error:', e.message); }
      await new Promise(r => setTimeout(r, 3600000));
    }
  } else {
    backup();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
