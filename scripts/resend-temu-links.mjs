#!/usr/bin/env node

/**
 * Resend Temu links as clean, short WhatsApp messages
 * Each link is sent individually so it generates a proper clickable preview
 * 
 * Run: node scripts/resend-temu-links.mjs
 * Dry run: node scripts/resend-temu-links.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEMU_FILE = path.join(ROOT, "exports", "procurement-requests", "temu-family-messages.json");
const SENT_LOG = path.join(ROOT, "exports", "procurement-requests", "temu-links-sent.json");

const OWNER_PHONE = "+212639158209";
const WA_SERVER = "http://localhost:3000";
const SEND_DELAY = 2000;

function loadJson(fp) {
  try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null; } catch { return null; }
}

function saveJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function sendWhatsApp(phone, message) {
  const res = await fetch(`${WA_SERVER}/send-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });
  return res.json();
}

function extractLinks(text) {
  const lines = text.split("\n");
  const links = [];
  let currentLabel = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^https?:\/\//.test(trimmed)) {
      links.push({ label: currentLabel, url: trimmed });
    } else if (trimmed.startsWith("Note:") || trimmed.startsWith("Budget:")) {
      currentLabel = "";
    } else {
      // Strip emoji prefix
      currentLabel = trimmed.replace(/^[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+\s*/u, "").replace(/^[-•*]\s*/, "");
    }
  }
  return links;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const data = loadJson(TEMU_FILE);
  if (!data?.messages) { console.log("No Temu messages found"); return; }

  const sent = loadJson(SENT_LOG) || { sent: [] };
  const sentUrls = new Set(sent.sent.map(s => s.url));

  let count = 0;

  for (const msg of data.messages) {
    const links = extractLinks(msg.message);
    for (const link of links) {
      if (sentUrls.has(link.url)) continue;

      const shortMsg = link.label
        ? `${link.label}\n${link.url}`
        : link.url;

      console.log(`→ ${link.label || "link"}: ${link.url.substring(0, 60)}...`);

      if (!dryRun) {
        try {
          const result = await sendWhatsApp(OWNER_PHONE, shortMsg);
          if (result.success) {
            sent.sent.push({ url: link.url, label: link.label, batch: msg.batch, sentAt: new Date().toISOString() });
            console.log(`  ✅ Sent`);
          } else {
            console.log(`  ❌ Failed: ${result.error}`);
          }
        } catch (e) {
          console.log(`  ❌ Error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, SEND_DELAY));
      }
      count++;
    }
  }

  saveJson(SENT_LOG, sent);
  console.log(`\nDone: ${count} links ${dryRun ? "(dry run)" : "sent"}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
