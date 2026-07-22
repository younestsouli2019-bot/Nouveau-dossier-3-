#!/usr/bin/env node

/**
 * WhatsApp Session Backup
 * Copies .wwebjs_auth2 to a safe location
 * 
 * Run: node scripts/backup-wa-session.mjs
 * Cron: Add to settle-cron or run daily
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WA_DIR = path.join(ROOT, "swarm-wa");
const SESSION_DIR = path.join(WA_DIR, ".wwebjs_auth2");
const BACKUP_DIR = path.join(ROOT, "exports", "wa-session-backup");
const MAX_BACKUPS = 5;

let skippedFiles = [];

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        if (e.code === 'EBUSY') {
          skippedFiles.push(entry.name);
          // Try read+write fallback
          try {
            const data = fs.readFileSync(srcPath);
            fs.writeFileSync(destPath, data);
          } catch {}
        }
      }
    }
  }
}

function main() {
  if (!fs.existsSync(SESSION_DIR)) {
    console.log("❌ No WhatsApp session found at", SESSION_DIR);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, `session-${timestamp}`);

  console.log(`📦 Backing up WhatsApp session...`);
  console.log(`   From: ${SESSION_DIR}`);
  console.log(`   To:   ${backupPath}`);

  copyDirSync(SESSION_DIR, backupPath);

  // Calculate size
  let size = 0;
  function dirSize(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) dirSize(p);
      else size += fs.statSync(p).size;
    }
  }
  dirSize(backupPath);

  console.log(`✅ Backup complete: ${backupPath} (${(size / 1024).toFixed(1)} KB)`);
  if (skippedFiles.length > 0) {
    console.log(`⚠️  Skipped ${skippedFiles.length} locked file(s): ${[...new Set(skippedFiles)].join(', ')}`);
    console.log(`   These are locked by the running WhatsApp server — safe to skip.`);
  }

  // Cleanup old backups
  if (fs.existsSync(BACKUP_DIR)) {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(b => b.startsWith("session-"))
      .sort()
      .reverse();

    if (backups.length > MAX_BACKUPS) {
      for (const old of backups.slice(MAX_BACKUPS)) {
        const oldPath = path.join(BACKUP_DIR, old);
        fs.rmSync(oldPath, { recursive: true, force: true });
        console.log(`🗑️  Removed old backup: ${old}`);
      }
    }
  }
}

main();
