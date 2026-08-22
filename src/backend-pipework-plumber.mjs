import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
	buildBase44ServiceClient,
	buildBase44Client,
} from "./base44-client.mjs";
import {
	addSecurityHeaders,
	validateRequest,
	validateAuth,
	detectPromptInjection,
	extractPayoutDestinations,
} from "./security-middleware.mjs";
import { fileURLToPath } from "url";

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getEnvBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).toLowerCase() === "true";
}

function getPlumberTokens() {
	return [
		process.env.BACKEND_PLUMBER_API_KEY,
		process.env.PLUMBER_API_KEY,
		process.env.SWARM_API_KEY,
		process.env.BASE44_SERVICE_TOKEN,
	]
		.filter(Boolean)
		.map((s) => String(s).trim())
		.filter((s) => s.length > 0);
}

function requirePlumberAuth(req, res, next) {
	const tokens = getPlumberTokens();
	if (tokens.length === 0) {
		// No tokens configured: only reachable on localhost loopback.
		const addr = req.socket?.remoteAddress || req.ip || "";
		if (addr.includes("127.0.0.1") || addr.includes("::1") || addr === "") {
			return next();
		}
		res.status(401).json({ ok: false, error: "Unauthorized" });
		return;
	}
	if (!validateAuth(req, tokens)) {
		res.status(401).json({ ok: false, error: "Unauthorized" });
		return;
	}
	next();
}

function guardPromptInjection(req, res, next) {
	if (req.body == null) return next();
	const found = detectPromptInjection(req.body);
	if (found) {
		res.status(400).json({
			ok: false,
			error: "Prompt injection blocked",
			label: found.label,
			field: found.location,
		});
		return;
	}
	next();
}

function guardFundDiversion(req, res, next) {
	if (req.body == null) return next();
	const allow = [
		process.env.OWNER_PAYPAL_EMAIL,
		process.env.OWNER_IBAN,
		process.env.OWNER_BANK_RIB,
		process.env.OWNER_BANK_ACCOUNT,
		process.env.OWNER_CRYPTO_ADDRESS,
		process.env.OWNER_TRUST_WALLET,
		process.env.OWNER_PAYONEER_ID,
	];
	const targets = extractPayoutDestinations(req.body);
	for (const t of targets) {
		const norm = String(t.value)
			.replace(/["']/g, "")
			.replace(/\s+/g, "")
			.toUpperCase();
		const ok = allow.some(
			(a) =>
				a &&
				String(a).replace(/["']/g, "").replace(/\s+/g, "").toUpperCase() ===
					norm,
		);
		if (!ok) {
			res.status(403).json({
				ok: false,
				error: "Fund_diversion_guard",
				field: t.path,
			});
			return;
		}
	}
	next();
}

function safeJson(v, fallback = null) {
	try {
		const s = typeof v === "string" ? v : JSON.stringify(v);
		const o = JSON.parse(s);
		return o && typeof o === "object" ? o : fallback;
	} catch {
		return fallback;
	}
}

async function appendJsonl(filePath, obj) {
	ensureDir(path.dirname(filePath));
	const line = `${JSON.stringify(obj)}\n`;
	await fsp.appendFile(filePath, line, "utf8");
}

function buildOwnerApi() {
	let client = null;
	function ensureClient() {
		if (client) return client;
		try {
			client = buildBase44ServiceClient({ mode: "auto" });
			return client;
		} catch {
			try {
				client = buildBase44Client({ mode: "offline" });
				return client;
			} catch {
				client = null;
				return null;
			}
		}
	}
	function getEntityApi(name) {
		const c = ensureClient();
		if (!c) throw new Error("Base44 client unavailable");
		return c.asServiceRole.entities[name];
	}
	async function getSafe(name, id) {
		const entity = getEntityApi(name);
		if (typeof entity.get === "function") {
			try {
				return await entity.get(id);
			} catch {}
		}
		const rows = await entity.filter({ id }, "-created_date", 1, 0);
		return Array.isArray(rows) && rows[0] ? rows[0] : null;
	}
	return {
		list: async (name, sort = "-created_date", limit = 50, offset = 0) => {
			const entity = getEntityApi(name);
			return entity.list(sort, limit, offset);
		},
		filter: async (
			name,
			filter = {},
			sort = "-created_date",
			limit = 50,
			offset = 0,
		) => {
			const entity = getEntityApi(name);
			return entity.filter(filter, sort, limit, offset);
		},
		get: async (name, id) => getSafe(name, id),
		create: async (name, data) => {
			const entity = getEntityApi(name);
			return entity.create(data);
		},
		update: async (name, id, patch) => {
			const entity = getEntityApi(name);
			return entity.update(id, patch);
		},
	};
}

function buildAgentInteractions() {
	const dataDir = path.resolve("data");
	const swarmDir = path.join(dataDir, "swarm");
	ensureDir(swarmDir);
	function readJsonSafe(p, fallback) {
		try {
			const txt = fs.readFileSync(p, "utf8");
			const j = JSON.parse(txt);
			return j && typeof j === "object" ? j : fallback;
		} catch {
			return fallback;
		}
	}
	async function writeJson(p, obj) {
		ensureDir(path.dirname(p));
		const txt = JSON.stringify(obj, null, 2);
		await fsp.writeFile(p, txt, "utf8");
	}
	return {
		status: () => {
			const agentsPath = path.join(swarmDir, "agents.json");
			const missionsPath = path.join(swarmDir, "missions.json");
			const agents = readJsonSafe(agentsPath, { agents: [] });
			const missions = readJsonSafe(missionsPath, { missions: [] });
			return { agents, missions };
		},
		writeMission: async (mission) => {
			const p = path.join(swarmDir, "missions.json");
			const s = readJsonSafe(p, { missions: [] });
			s.missions = Array.isArray(s.missions) ? s.missions : [];
			s.missions.push({
				...mission,
				id: mission.id || `mission_${Date.now()}`,
			});
			await writeJson(p, s);
			return { ok: true };
		},
	};
}

function buildWebhooks() {
	const paypalOut = path.resolve("out", "paypal", "webhooks.jsonl");
	const stripeOut = path.resolve("out", "stripe", "webhooks.jsonl");
	return {
		paypal: async (event) => {
			const payload = safeJson(event, null);
			await appendJsonl(paypalOut, { ts: new Date().toISOString(), payload });
			return { ok: true };
		},
		stripe: async (event) => {
			const payload = safeJson(event, null);
			await appendJsonl(stripeOut, { ts: new Date().toISOString(), payload });
			return { ok: true };
		},
	};
}

function buildSettlementOps() {
	function orchestrate({ intentEnvelope, dryRun = true, kid = null }) {
		return new Promise((resolve) => {
			const args = [];
			if (dryRun) args.push("--dry-run");
			if (kid) {
				args.push("--kid", String(kid));
			}
			if (intentEnvelope && typeof intentEnvelope === "object") {
				args.push("--intent-envelope", JSON.stringify(intentEnvelope));
			}
			const proc = spawn(
				"node",
				[path.resolve("src", "orchestrate-settlement.mjs"), ...args],
				{
					env: process.env,
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let out = "";
			let err = "";
			proc.stdout.on("data", (d) => {
				out += String(d);
			});
			proc.stderr.on("data", (d) => {
				err += String(d);
			});
			proc.on("close", () => {
				const last = out.trim().split("\n").filter(Boolean).pop() || "{}";
				let parsed = null;
				try {
					parsed = JSON.parse(last);
				} catch {
					parsed = { ok: false, raw: last };
				}
				resolve({
					ok: Boolean(parsed?.ok),
					data: parsed,
					error: err.trim() || null,
				});
			});
		});
	}
	return { orchestrate };
}

export function createApp() {
	const app = express();
	app.use(bodyParser.json({ limit: "1mb" }));
	app.use((req, res, next) => {
		addSecurityHeaders(res);
		const invalid = validateRequest(req);
		if (invalid) {
			res.status(invalid.status).json({ ok: false, error: invalid.error });
			return;
		}
		next();
	});
		app.use((req, _res, next) => {
			console.log(`[BackendPlumber] ${req.method} ${req.path}`);
			next();
		});
	app.use((req, res, next) => {
		if (req.path === "/" || req.path === "") {
			res
				.type("application/json")
				.send(
					JSON.stringify({
						ok: true,
						service: "backend-plumber",
						endpoints: [
							"GET /api/owner/:entity",
							"GET /api/owner/:entity/:id",
							"POST /api/owner/:entity",
							"PATCH /api/owner/:entity/:id",
							"GET /api/agents/status",
							"POST /api/agents/mission",
							"POST /api/webhooks/paypal",
							"POST /api/webhooks/stripe",
							"POST /api/settlement/orchestrate",
						],
					}),
				);
			return;
		}
		next();
	});
	const ownerApi = buildOwnerApi();
	const agents = buildAgentInteractions();
	const webhooks = buildWebhooks();
	const settlement = buildSettlementOps();

  app.get("/", (_req, res) => {
    res.type("application/json").send(JSON.stringify({
      ok: true,
      service: "backend-plumber",
      endpoints: [
        "GET /api/owner/:entity",
        "GET /api/owner/:entity/:id",
        "POST /api/owner/:entity",
        "PATCH /api/owner/:entity/:id",
        "GET /api/agents/status",
        "POST /api/agents/mission",
        "POST /api/webhooks/paypal",
        "POST /api/webhooks/stripe",
        "POST /api/settlement/orchestrate"
      ]
    }));
  });

	app.get("/api/owner/:entity", requirePlumberAuth, async (req, res) => {
		try {
			const r = await ownerApi.list(
				req.params.entity,
				req.query.sort,
				Number(req.query.limit ?? "50") || 50,
				Number(req.query.offset ?? "0") || 0,
			);
			res.json({ ok: true, rows: r });
		} catch (e) {
			res.status(500).json({ ok: false, error: String(e.message || e) });
		}
	});
	app.get("/api/owner/:entity/:id", requirePlumberAuth, async (req, res) => {
		try {
			const r = await ownerApi.get(req.params.entity, req.params.id);
			res.json({ ok: true, row: r });
		} catch (e) {
			res.status(500).json({ ok: false, error: String(e.message || e) });
		}
	});
	app.post(
		"/api/owner/:entity",
		requirePlumberAuth,
		guardPromptInjection,
		guardFundDiversion,
		async (req, res) => {
			try {
				const r = await ownerApi.create(req.params.entity, req.body || {});
				res.json({ ok: true, id: r?.id ?? null, row: r });
			} catch (e) {
				res.status(500).json({ ok: false, error: String(e.message || e) });
			}
		},
	);
	app.patch(
		"/api/owner/:entity/:id",
		requirePlumberAuth,
		guardPromptInjection,
		guardFundDiversion,
		async (req, res) => {
			try {
				const r = await ownerApi.update(
					req.params.entity,
					req.params.id,
					req.body || {},
				);
				res.json({ ok: true, row: r });
			} catch (e) {
				res.status(500).json({ ok: false, error: String(e.message || e) });
			}
		},
	);

	app.get("/api/agents/status", requirePlumberAuth, async (_req, res) => {
		try {
			const r = await agents.status();
			res.json({ ok: true, status: r });
		} catch (e) {
			res.status(500).json({ ok: false, error: String(e.message || e) });
		}
	});
	app.post(
		"/api/agents/mission",
		requirePlumberAuth,
		guardPromptInjection,
		guardFundDiversion,
		async (req, res) => {
			try {
				const r = await agents.writeMission(req.body || {});
				res.json({ ok: true, result: r });
			} catch (e) {
				res.status(500).json({ ok: false, error: String(e.message || e) });
			}
		},
	);

	app.post("/api/webhooks/paypal", async (req, res) => {
		try {
			const r = await webhooks.paypal(req.body || {});
			res.json(r);
		} catch (e) {
			res.status(500).json({ ok: false, error: String(e.message || e) });
		}
	});
	app.post("/api/webhooks/stripe", async (req, res) => {
		try {
			const r = await webhooks.stripe(req.body || {});
			res.json(r);
		} catch (e) {
			res.status(500).json({ ok: false, error: String(e.message || e) });
		}
	});

	app.post(
		"/api/settlement/orchestrate",
		requirePlumberAuth,
		guardPromptInjection,
		guardFundDiversion,
		async (req, res) => {
			try {
				const intentEnvelope = safeJson(req.body?.intentEnvelope, null);
				const kid = req.body?.kid ?? null;
				const dryRun = req.body?.dryRun !== false;
				const r = await settlement.orchestrate({ intentEnvelope, dryRun, kid });
				res.json(r);
			} catch (e) {
				res.status(500).json({ ok: false, error: String(e.message || e) });
			}
		},
	);

	app.get(/.*/, (_req, res) => {
		res
			.type("application/json")
			.send(
				JSON.stringify({
					ok: true,
					service: "backend-plumber",
					endpoints: [
						"GET /api/owner/:entity",
						"GET /api/owner/:entity/:id",
						"POST /api/owner/:entity",
						"PATCH /api/owner/:entity/:id",
						"GET /api/agents/status",
						"POST /api/agents/mission",
						"POST /api/webhooks/paypal",
						"POST /api/webhooks/stripe",
						"POST /api/settlement/orchestrate",
					],
				}),
			);
	});

	return app;
}

export async function startServer({
	port = Number(process.env.PORT ?? "8787") || 8787,
} = {}) {
	// Single-instance PID guard
	try {
		const pidDir = path.resolve("out", "plumber");
		ensureDir(pidDir);
		const pidPath = path.join(pidDir, "backend-plumber.pid");
		if (fs.existsSync(pidPath)) {
			const existing = Number(String(fs.readFileSync(pidPath, "utf8")).trim());
			if (existing > 0) {
				try {
					process.kill(existing, 0);
					console.log(
						`[BackendPlumber] Another instance is running (PID ${existing}); refusing to start`,
					);
					return { ok: false, port, server: null };
				} catch {}
			}
		}
		fs.writeFileSync(pidPath, String(process.pid), "utf8");
		process.on("exit", () => {
			try {
				fs.unlinkSync(pidPath);
			} catch {}
		});
	} catch {}
	const app = createApp();
	return new Promise((resolve) => {
		const srv = app.listen(port, () => {
			console.log(`[BackendPlumber] Listening on http://localhost:${port}`);
			resolve({ ok: true, port, server: srv });
		});
	});
}

export const default_api = {
	ownerAPI: buildOwnerApi(),
	agentInteractions: buildAgentInteractions(),
	webhooks: buildWebhooks(),
	settlement: buildSettlementOps(),
};

const thisFile = fileURLToPath(import.meta.url);
const mainPath = path.resolve(
	process.cwd(),
	"src",
	"backend-pipework-plumber.mjs",
);
if (thisFile === mainPath) {
	startServer();
}
