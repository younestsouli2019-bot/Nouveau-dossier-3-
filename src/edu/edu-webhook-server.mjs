import http from "node:http";
import { getEnvBool, getEnvNumber } from "./base-client.mjs";
import { PurchaseReconciler } from "./purchase-reconciliation.mjs";
import { AffiliateProgram } from "./affiliate-program.mjs";
import { verifyMainSiteWebhookSignature } from "./main-site-client.mjs";

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
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		if (url.pathname === "/webhook/teachable" && req.method === "POST") {
			const rawBody = await readBody(req);
			const signatureHeader = req.headers["x-teachable-webhook-signature"];
			const event = JSON.parse(rawBody.toString("utf-8"));
			const result = await reconcilerInstance.reconcile({
				platform: "teachable",
				event,
				rawBody: rawBody.toString("utf-8"),
				signatureHeader,
				secret,
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		if (url.pathname === "/webhook/learnworlds" && req.method === "POST") {
			const rawBody = await readBody(req);
			const signatureHeader = req.headers["x-lw-signature"];
			const event = JSON.parse(rawBody.toString("utf-8"));
			const result = await reconcilerInstance.reconcile({
				platform: "learnworlds",
				event,
				rawBody: rawBody.toString("utf-8"),
				signatureHeader,
				secret,
			});
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
			const result = await reconcilerInstance.reconcile({
				platform: "realworldcerts",
				event,
				rawBody: rawBody.toString("utf-8"),
				signatureHeader,
				secret,
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
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
		console.log("  POST /webhook/affiliate");
		console.log("  GET  /health");
	});
}

if (process.argv[1] && process.argv[1].endsWith("edu-webhook-server.mjs")) {
	main().catch((e) => {
		console.error(`[EDU] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default createEduWebhookServer;
