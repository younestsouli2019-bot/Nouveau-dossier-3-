import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(u, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

function extractOgImage(html) {
  const mA = html.match(/<a[\s\S]*?class=["'][^"']*woocommerce-product-gallery__image[^"']*["'][\s\S]*?href=["']([^"']+)["'][\s\S]*?>/i);
  if (mA && mA[1]) return mA[1];
  const mWc = html.match(/<img[\s\S]*?class=["'][^"']*(wp-post-image|woocommerce-product-gallery__image)[^"']*["'][\s\S]*?(?:data-large_image|data-src|src)=["']([^"']+)["'][\s\S]*?>/i);
  if (mWc && mWc[2]) return mWc[2];
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1 && m1[1]) return m1[1];
  const m2 = html.match(/<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m2 && m2[1]) return m2[1];
  const m3 = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (m3 && m3[1]) return m3[1];
  return null;
}

async function main() {
  const srcUrl = process.argv[2];
  const outPath = process.argv[3];
  if (!srcUrl || !outPath) {
    process.stderr.write(JSON.stringify({ ok: false, error: "usage", hint: "node fetch-product-image.mjs <url> <outPath>" }) + "\n");
    process.exitCode = 1;
    return;
  }
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const htmlBuf = await get(srcUrl);
    const html = htmlBuf.toString("utf8");
    const imgUrl = extractOgImage(html);
    if (!imgUrl) {
      process.stderr.write(JSON.stringify({ ok: false, error: "no_image_found", url: srcUrl }) + "\n");
      process.exitCode = 1;
      return;
    }
    const absImgUrl = imgUrl.startsWith("http") ? imgUrl : new URL(imgUrl, srcUrl).toString();
    const imgBuf = await get(absImgUrl);
    fs.writeFileSync(outPath, imgBuf);
    process.stdout.write(JSON.stringify({ ok: true, url: absImgUrl, outPath }) + "\n");
  } catch (e) {
    process.stderr.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) + "\n");
    process.exitCode = 1;
  }
}

main();
