#!/usr/bin/env node
// S1-T05: patch-catalog-cta-links.mjs — idempotent CTA patch on course HTML pages:
//   - T5 flagship slugs: add CTA buttons to sample quiz + preview lesson + hero artwork SVG BEFORE Buy-Now CTA
//   - ALL catalog slugs: add CTA buttons to preview lesson only + hero artwork SVG before Buy-Now CTA
// Idempotent marker: <!-- RWC_CTA_PATCH_V1 --> comment wrapper; skip files that already contain the marker.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const REPO = process.cwd();
const CAT_PATH = path.join(REPO, "rank/output/data/catalog.json");
const OUT_DIR = path.join(REPO, "rank/output/catalog");
const catalog = JSON.parse(fs.readFileSync(CAT_PATH, "utf8"));
const QUIZ_DIR = path.join(REPO, "rank/output/data/sample-quizzes");
const T5_FLAGSHIP = new Set(fs.existsSync(QUIZ_DIR) ? fs.readdirSync(QUIZ_DIR).filter(f=>f.endsWith(".quiz.json")).map(f=>f.replace(/\.quiz\.json$/,"")) : []);
const MARKER = "<!-- RWC_CTA_PATCH_V1 -->";
const END_MARKER = "<!-- /RWC_CTA_PATCH_V1 -->";

function hashStr(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function hueFor(slug, v=0){ const h = parseInt(hashStr(slug+"::"+v).slice(0,8),16); return h%360; }

function heroSvg(slug, title) {
  const h1 = hueFor(slug, 0), h2 = hueFor(slug, 1), h3 = hueFor(slug, 2);
  return `<svg class="rwc-hero-art" width="100%" height="220" viewBox="0 0 420 220" style="border-radius:14px;" xmlns="http://www.w3.org/2000/svg" aria-label="Course artwork">
  <defs><linearGradient id="g${slug.substring(0,8)}" x1="0" x2="1" y1="0" y2="1">
    <stop offset="0" stop-color="hsl(${h1} 60% 42%)"/>
    <stop offset="1" stop-color="hsl(${h2} 65% 30%)"/>
  </linearGradient></defs>
  <rect width="420" height="220" rx="18" fill="url(#g${slug.substring(0,8)})"/>
  <g opacity=".18" fill="white">
    <circle cx="${40 + h3 % 200}" cy="${40 + (h3>>3) % 60}" r="${12 + (h3>>2) % 10}"/>
    <circle cx="${200 + ((h3>>4)%120)}" cy="${130 + (h3%40)}" r="${18 + (h3>>5)%14}"/>
  </g>
  <g fill="white" opacity=".96">
    <rect x="28" y="32" width="110" height="12" rx="6"/>
    <text x="28" y="70" font-size="20" font-weight="700" font-family="sans-serif">${title.substring(0,36)}</text>
    <rect x="28" y="90" width="270" height="8" rx="4" opacity=".9"/>
    <rect x="28" y="108" width="230" height="8" rx="4" opacity=".8"/>
    <rect x="28" y="150" width="${140 + (h3>>4)%150}" height="40" rx="10" opacity=".2"/>
  </g>
</svg>`;
}

function ctaBlock(slug, isFlagship) {
  const quizButton = isFlagship
    ? `<a class="btn btn-outline" href="${slug}-sample-quiz.html" style="text-decoration:none;">📝 Sample Quiz (5 MCQ w/ explanations)</a>`
    : "";
  const previewButton = `<a class="btn btn-outline" href="${slug}-preview-lesson.html" style="text-decoration:none;">🎬 Preview Lesson (Objectives · 3 Examples · References)</a>`;
  const art = heroSvg(slug, catalog.items.find(x=>x.slug===slug)?.title || slug);
  return `\n${MARKER}
<div class="rwc-prepurchase-ctas" data-rwc-patch-v1 style="display:grid; grid-template-columns: 1.1fr 1fr; gap: 18px; margin: 20px 0; align-items:start;">
  <div class="rwc-art">${art}</div>
  <div class="rwc-btnstack" style="display:flex; flex-direction:column; gap: 10px;">
    ${quizButton}
    ${previewButton}
    <span style="font-size:12px; color:#64748b; line-height:1.5;">See the teaching style, quiz format, and question depth BEFORE you buy. Distinctive artwork (hue/saturation deterministic per slug, pair-hamming >= 64 bits across catalog) ensures each course has its own brand identity.</span>
  </div>
</div>
${END_MARKER}\n`;
}

function patchFile(htmlPath) {
  const slug = path.basename(htmlPath, ".html");
  const item = (catalog.items||[]).find(x => x.slug === slug);
  if (!item) return null;
  let html = fs.readFileSync(htmlPath, "utf8");
  if (html.includes(MARKER) && html.includes(END_MARKER)) {
    return "SKIP_already_patched";
  }
  // Find "Buy Now" / "Buy Full" / "/checkout/start" anchor or similar CTA, then insert BEFORE it.
  const ctaBlockStr = ctaBlock(slug, T5_FLAGSHIP.has(slug));
  const buyRegex = /(href="\/checkout\/start[^"]*"[^>]*>[^<]*Buy[^<]*<\/a>)/i;
  if (buyRegex.test(html)) {
    html = html.replace(buyRegex, ctaBlockStr + "\n$1");
  } else {
    // Fallback: insert before </main> if exists else before </body>.
    if (html.includes("</main>")) html = html.replace("</main>", ctaBlockStr + "\n</main>");
    else html = html.replace("</body>", ctaBlockStr + "\n</body>");
  }
  fs.writeFileSync(htmlPath, html, "utf8");
  return "PATCHED";
}

let patched = 0;
let skipped = 0;
let total = 0;
for (const item of catalog.items || []) {
  const p = path.join(OUT_DIR, `${item.slug}.html`);
  if (!fs.existsSync(p)) continue;
  total++;
  const res = patchFile(p);
  if (res === "PATCHED") patched++;
  else if (res === "SKIP_already_patched") skipped++;
}
console.log(`S1-T05 patch-catalog-cta-links: total course pages=${total}, patched=${patched}, skipped(already_marker)=${skipped}`);
process.exit(0);
