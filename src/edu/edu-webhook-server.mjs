import http from "node:http";
import fs from "node:fs";
import path from "node:path";
/*turbopackIgnore: true*/
const joinPath = (...parts) => path.join(...parts);
import { getEnvBool, getEnvNumber } from "./base-client.mjs";
import { PurchaseReconciler } from "./purchase-reconciliation.mjs";
import { AffiliateProgram } from "./affiliate-program.mjs";
import { verifyMainSiteWebhookSignature } from "./main-site-client.mjs";

const DATA_OUT_DIR = joinPath(process.cwd(), "data", "out");
const DEDUP_FILE = joinPath(DATA_OUT_DIR, "rwc-dedup.ndjson");
const DLQ_FILE = joinPath(DATA_OUT_DIR, "rwc-dlq.ndjson");

function ensureDirs() {
  try {
    if (!fs.existsSync(DATA_OUT_DIR)) fs.mkdirSync(DATA_OUT_DIR, { recursive: true });
  } catch {}
}
ensureDirs();

const processedIds = new Set();
(function loadDedup() {
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const lines = fs.readFileSync(DEDUP_FILE, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          if (row?.id) processedIds.add(row.id);
        } catch {}
      }
    }
  } catch {}
})();

function appendNdjson(file, row) {
  try {
    ensureDirs();
    fs.appendFileSync(file, JSON.stringify(row) + "\n");
    return true;
  } catch {
    return false;
  }
}

function dedupKey(platform, event) {
  const id = event?.orderId || event?.saleId || event?.id || event?.transactionId || event?.enrollment_id;
  if (!id) return null;
  return `${platform}:${String(id)}`;
}

function readDlq() {
  try {
    if (!fs.existsSync(DLQ_FILE)) return [];
    return fs.readFileSync(DLQ_FILE, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function removeFromDlq(key) {
  try {
    if (!fs.existsSync(DLQ_FILE)) return;
    const rows = readDlq().filter((r) => r.key !== key);
    fs.writeFileSync(DLQ_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  } catch {}
}

const counters = { processed: 0, deduped: 0, retried: 0, dlq: readDlq().length };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function reconcileWithRetry(reconcilerInstance, opts, maxAttempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await reconcilerInstance.reconcile(opts);
      return { result, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        counters.retried++;
        await sleep(200 * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastErr;
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

export function createEduWebhookServer({ reconciler, affiliateProgram, secret = process.env.EDU_WEBHOOK_SECRET } = {}) {
	const reconcilerInstance =
		reconciler ?? new PurchaseReconciler({ platforms: {}, ledgerPath: undefined });
	const affiliateInstance =
		affiliateProgram ??
		(getEnvBool("AFFILIATE_ENABLED", false)
			? new AffiliateProgram({ live: getEnvBool("SWARM_LIVE", false) })
			: null);
	if (affiliateInstance) reconcilerInstance.affiliateProgram = affiliateInstance;

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${process.env.EDU_WEBHOOK_PORT || 9877}`);

		if (url.pathname === "/health" && req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok", uptime_ms: process.uptime() * 1000 }));
			return;
		}

		if (url.pathname === "/webhook/realworldcerts/stats" && req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
        status: "ok",
        counters,
        dedupMemorySize: processedIds.size,
        dlqCount: readDlq().length,
      }));
			return;
		}

		if (url.pathname === "/webhook/realworldcerts/retry-dlq" && req.method === "POST") {
			const items = readDlq();
      let processed = 0;
      let failed = 0;
      for (const row of items) {
        try {
          const res2 = await reconcilerInstance.reconcile(row.opts);
          if (res2 && (res2.status === "VERIFIED" || res2.status === "DUPLICATE")) {
            removeFromDlq(row.key);
            counters.dlq = Math.max(0, counters.dlq - 1);
            processed++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      counters.dlq = readDlq().length;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok", processed, failed, remaining: counters.dlq }));
			return;
		}

		if (url.pathname === "/webhook/teachable" && req.method === "POST") {
			const rawBody = await readBody(req);
			const signatureHeader = req.headers["x-teachable-webhook-signature"];
			const event = JSON.parse(rawBody.toString("utf-8"));
      const key = dedupKey("teachable", event);
      if (key && processedIds.has(key)) {
        counters.deduped++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "DUPLICATE", id: key, reason: "already processed" }));
        return;
      }
			const result = await reconcilerInstance.reconcile({
				platform: "teachable",
				event,
				rawBody: rawBody.toString("utf-8"),
				signatureHeader,
				secret,
			});
      if (key) {
        processedIds.add(key);
        appendNdjson(DEDUP_FILE, { id: key, ts: Date.now(), status: result?.status });
      }
      counters.processed++;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		if (url.pathname === "/webhook/learnworlds" && req.method === "POST") {
			const rawBody = await readBody(req);
			const signatureHeader = req.headers["x-lw-signature"];
			const event = JSON.parse(rawBody.toString("utf-8"));
      const key = dedupKey("learnworlds", event);
      if (key && processedIds.has(key)) {
        counters.deduped++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "DUPLICATE", id: key, reason: "already processed" }));
        return;
      }
			const result = await reconcilerInstance.reconcile({
				platform: "learnworlds",
				event,
				rawBody: rawBody.toString("utf-8"),
				signatureHeader,
				secret,
			});
      if (key) {
        processedIds.add(key);
        appendNdjson(DEDUP_FILE, { id: key, ts: Date.now(), status: result?.status });
      }
      counters.processed++;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		if (url.pathname === "/webhook/realworldcerts" && req.method === "POST") {
			const rawBody = await readBody(req);
			const signatureHeader = req.headers["x-rwc-signature"];
			const valid = verifyMainSiteWebhookSignature({
				signature: signatureHeader,
				payload: rawBody.toString("utf-8"),
				secret,
			});
			if (!valid) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "REJECTED", reason: "invalid signature" }));
				return;
			}
			const event = JSON.parse(rawBody.toString("utf-8"));
      const key = dedupKey("realworldcerts", event);
      if (key && processedIds.has(key)) {
        counters.deduped++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "DUPLICATE", id: key, reason: "already processed" }));
        return;
      }
      const opts = {
        platform: "realworldcerts",
        event,
        rawBody: rawBody.toString("utf-8"),
        signatureHeader,
        secret,
      };
      try {
        const { result, attempts } = await reconcileWithRetry(reconcilerInstance, opts, 3);
        if (key) {
          processedIds.add(key);
          appendNdjson(DEDUP_FILE, { id: key, ts: Date.now(), status: result?.status, attempts });
        }
        counters.processed++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...result, attempts }));
        return;
      } catch (e) {
        if (key) {
          appendNdjson(DLQ_FILE, {
            key,
            ts: Date.now(),
            error: e?.message || String(e),
            stack: e?.stack?.slice(0, 500) || undefined,
            opts: { ...opts, secret: undefined },
          });
          counters.dlq++;
        }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "DLQ", id: key, reason: e?.message || "permanent failure", dlq: true }));
        return;
      }
		}

		if (url.pathname === "/webhook/affiliate" && req.method === "POST") {
			const rawBody = await readBody(req);
			const event = JSON.parse(rawBody.toString("utf-8"));
			if (!affiliateInstance) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "SKIPPED", reason: "affiliate program disabled" }));
				return;
			}
			if (event?.action === "recruit") {
				const created = affiliateInstance.recruitLoop({
					sponsorEmail: event.sponsorEmail,
					sponsorDestination: event.sponsorDestination ?? {},
					recruits: event.recruits ?? [],
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "RECRUITED", count: created.length }));
				return;
			}
			if (event?.action === "approve") {
				const approved = affiliateInstance.approvePayouts({
					ownerDestination: event.ownerDestination ?? {},
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "APPROVED", ...approved }));
				return;
			}
			res.writeHead(400);
			res.end("Unknown action");
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	});

	return server;
}

async function main() {
	const port = getEnvNumber("EDU_WEBHOOK_PORT", 9877);
	const server = createEduWebhookServer();
	server.listen(port, () => {
		console.log(`[EDU] Webhook listener on :${port}`);
		console.log("  POST /webhook/teachable");
		console.log("  POST /webhook/learnworlds");
		console.log("  POST /webhook/realworldcerts");
		console.log("  POST /webhook/realworldcerts/retry-dlq");
		console.log("  GET  /webhook/realworldcerts/stats");
		console.log("  POST /webhook/affiliate");
		console.log("  GET  /health");
		console.log(`[EDU] Dedup loaded ${processedIds.size} IDs | DLQ ${counters.dlq} items`);
	});
}

if (process.argv[1] && process.argv[1].endsWith("edu-webhook-server.mjs")) {
	main().catch((e) => {
		console.error(`[EDU] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default createEduWebhookServer;
