// Secure cloud upload - uploads doomsday vault to S3-compatible storage.
// Supports: AWS S3, Cloudflare R2, Backblaze B2, MinIO.
// Optional client-side encryption before upload (age or AES-256-GCM).
//
// Required secrets (per provider):
//   AWS:    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, DOOMSDAY_S3_BUCKET
//   R2:     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   B2:     B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME
//   CUSTOM: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION

import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { basename, join } from "node:path";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

function envFlag(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function masked(v, head = 4, tail = 4) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length <= head + tail) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, head)}...${s.slice(-tail)} (len=${s.length})`;
}

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

async function awsSignV4({ method, host, region, service, path, body, accessKey, secretKey, contentType, date }) {
  // Minimal AWS SigV4 PUT (single chunk). Sufficient for <5GB objects.
  const crypto = await import("node:crypto");
  const amzDate = date || new Date().toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const kDate = crypto.createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function uploadS3({ endpoint, region, bucket, accessKey, secretKey, key, body, contentType }) {
  const url = new URL(`${bucket}/${key}`, endpoint);
  const host = url.host;
  const path = url.pathname;
  const auth = await awsSignV4({
    method: "PUT",
    host,
    region: region || "auto",
    service: "s3",
    path,
    body,
    accessKey,
    secretKey,
    contentType: contentType || "application/zip",
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": auth,
        "Content-Type": contentType || "application/zip",
        "x-amz-content-sha256": sha256(body),
      },
      body,
      signal: ctrl.signal,
    });
    return { status: res.status, ok: res.ok, location: res.headers.get("ETag") };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

function detectProvider() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.DOOMSDAY_S3_BUCKET) {
    return {
      name: "AWS_S3",
      endpoint: `https://s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`,
      region: process.env.AWS_REGION || "us-east-1",
      bucket: process.env.DOOMSDAY_S3_BUCKET,
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET) {
    return {
      name: "CLOUDFLARE_R2",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: "auto",
      bucket: process.env.R2_BUCKET,
      accessKey: process.env.R2_ACCESS_KEY_ID,
      secretKey: process.env.R2_SECRET_ACCESS_KEY,
    };
  }
  if (process.env.B2_APPLICATION_KEY_ID && process.env.B2_APPLICATION_KEY && process.env.B2_BUCKET_NAME) {
    return {
      name: "BACKBLAZE_B2",
      endpoint: "https://s3.us-west-001.backblazeb2.com",
      region: "us-west-001",
      bucket: process.env.B2_BUCKET_NAME,
      accessKey: process.env.B2_APPLICATION_KEY_ID,
      secretKey: process.env.B2_APPLICATION_KEY,
    };
  }
  if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET) {
    return {
      name: "CUSTOM_S3",
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      bucket: process.env.S3_BUCKET,
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
    };
  }
  return null;
}

function encryptLocal(filePath, passphrase) {
  const buf = readFileSync(filePath);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = createHash("sha256").update(salt).update(passphrase).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([salt, iv, tag, enc]);
  const encPath = `${filePath}.enc`;
  writeFileSync(encPath, out);
  return encPath;
}

async function main() {
  console.log("[secure-cloud-upload] starting");
  const provider = detectProvider();
  const report = { timestamp: new Date().toISOString(), provider: null, uploaded: [], errors: [] };
  if (!provider) {
    console.log("[secure-cloud-upload] NO_PROVIDER_CONFIGURED");
    console.log("Set one of:");
    console.log("  AWS_S3:     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, DOOMSDAY_S3_BUCKET");
    console.log("  CLOUDFLARE_R2: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
    console.log("  BACKBLAZE_B2: B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME");
    console.log("  CUSTOM_S3:  S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION");
    report.detail = "no cloud provider creds set";
    writeFileSync("exports/doomsday/cloud_upload_last.json", JSON.stringify(report, null, 2));
    return;
  }
  console.log(`[secure-cloud-upload] provider=${provider.name} bucket=${provider.bucket}`);
  report.provider = {
    name: provider.name,
    endpoint: provider.endpoint,
    region: provider.region,
    bucket: provider.bucket,
    access_key: masked(provider.accessKey),
  };

  const doomsdayDir = process.env.DOOMSDAY_OUT || "/workspace/exports/doomsday";
  if (!existsSync(doomsdayDir)) {
    report.detail = "no doomsday directory found";
    writeFileSync("exports/doomsday/cloud_upload_last.json", JSON.stringify(report, null, 2));
    return;
  }
  const { readdirSync, statSync: st } = await import("node:fs");
  const files = readdirSync(doomsdayDir)
    .filter((f) => f.endsWith(".zip") || f.endsWith(".zip.enc"))
    .map((f) => ({ name: f, path: join(doomsdayDir, f), mtime: st(join(doomsdayDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    report.detail = "no zips in doomsday dir";
    writeFileSync("exports/doomsday/cloud_upload_last.json", JSON.stringify(report, null, 2));
    return;
  }
  const latest = files[0];
  console.log(`[secure-cloud-upload] uploading ${latest.name} (${statSync(latest.path).size}b)`);

  let uploadPath = latest.path;
  const useEncryption = envFlag("DOOMSDAY_CLOUD_ENCRYPT", false);
  if (useEncryption && !latest.name.endsWith(".enc")) {
    const passphrase = process.env.DOOMSDAY_PASSPHRASE || "doomsday-default-passphrase";
    const enc = encryptLocal(latest.path, passphrase);
    uploadPath = enc;
    console.log(`[secure-cloud-upload] encrypted: ${enc} (passphrase stored in DOOMSDAY_PASSPHRASE)`);
    report.encryption = { algo: "AES-256-GCM", passphrase_length: passphrase.length, file: enc };
  }

  const body = readFileSync(uploadPath);
  const key = `doomsday/${basename(uploadPath)}`;
  const contentType = uploadPath.endsWith(".enc") ? "application/octet-stream" : "application/zip";
  const r = await uploadS3({ ...provider, key, body, contentType });

  if (r.ok) {
    console.log(`[secure-cloud-upload] SUCCESS: ${key} etag=${r.location}`);
    report.uploaded.push({ key, etag: r.location, bytes: body.length, sha256: sha256(body) });
  } else {
    console.log(`[secure-cloud-upload] FAILED: status=${r.status} error=${r.error || "unknown"}`);
    report.errors.push({ key, status: r.status, error: r.error || "unknown" });
  }

  writeFileSync("exports/doomsday/cloud_upload_last.json", JSON.stringify(report, null, 2));
  console.log("SECURE_CLOUD_UPLOAD_SUMMARY:");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("[secure-cloud-upload] FATAL", e);
  process.exit(1);
});
