import https from "node:https";
import "../load-env.mjs";
function env(name, fallback = "") {
	const v = process.env[name];
	return v == null ? fallback : String(v).trim();
}
function envTrue(v) {
	return String(v ?? "false").toLowerCase() === "true";
}
function log(...a) {
	process.stdout.write(a.join(" ") + "\n");
}
function vercelApi(method, path, body = null) {
	const token = env("VERCEL_TOKEN");
	const teamId = env("VERCEL_TEAM_ID");
	const fullPath = teamId
		? `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(teamId)}`
		: path;
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: "api.vercel.com",
				path: fullPath,
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					let parsed = null;
					try {
						parsed = data ? JSON.parse(data) : null;
					} catch {}
					resolve({
						ok: res.statusCode >= 200 && res.statusCode < 300,
						status: res.statusCode,
						data: parsed,
					});
				});
			},
		);
		req.on("error", (e) => reject(e));
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}
async function getProjectId() {
	const explicit = env("VERCEL_PROJECT_ID");
	if (explicit) return explicit;
	const name = env("VERCEL_PROJECT_NAME", "realworldcerts");
	const r = await vercelApi("GET", "/v9/projects?limit=50");
	const list = Array.isArray(r?.data?.projects)
		? r.data.projects
		: Array.isArray(r?.data)
			? r.data
			: [];
	for (const p of list) {
		if (String(p?.name ?? "").trim() === name) return String(p.id);
	}
	return null;
}
async function ensureDomainInProject(projectId, domain) {
	const listRes = await vercelApi(
		"GET",
		`/v9/projects/${encodeURIComponent(projectId)}/domains`,
	);
	const domains = Array.isArray(listRes?.data)
		? listRes.data
		: Array.isArray(listRes?.data?.domains)
			? listRes.data.domains
			: [];
	const exists = domains.some((d) => String(d?.name ?? "") === domain);
	if (exists) return { ok: true, existed: true };
	const addRes = await vercelApi(
		"POST",
		`/v9/projects/${encodeURIComponent(projectId)}/domains`,
		{ name: domain },
	);
	return { ok: addRes.ok, created: addRes.ok };
}
async function getDomainConfig(domain) {
	const r = await vercelApi(
		"GET",
		`/v10/domains/${encodeURIComponent(domain)}/config`,
	);
	return r;
}
async function verifyDomain(domain) {
	const r = await vercelApi("POST", `/v10/domains/verify`, { domain });
	return r;
}
async function ensureWwwRedirect(projectId, apex) {
	const www = `www.${apex}`;
	const listRes = await vercelApi(
		"GET",
		`/v9/projects/${encodeURIComponent(projectId)}/domains`,
	);
	const domains = Array.isArray(listRes?.data)
		? listRes.data
		: Array.isArray(listRes?.data?.domains)
			? listRes.data.domains
			: [];
	const exists = domains.some((d) => String(d?.name ?? "") === www);
	if (exists) return { ok: true, existed: true };
	const addRes = await vercelApi(
		"POST",
		`/v9/projects/${encodeURIComponent(projectId)}/domains`,
		{ name: www, redirect: apex },
	);
	return { ok: addRes.ok, created: addRes.ok };
}
async function main() {
	const token = env("VERCEL_TOKEN");
	if (!token) {
		log("❌ Missing VERCEL_TOKEN in environment");
		process.exitCode = 1;
		return;
	}
	const apex = env("VERCEL_DOMAIN", "realworldcerts.com");
	const projectId = await getProjectId();
	if (!projectId) {
		log(
			"❌ Could not resolve Vercel project id (set VERCEL_PROJECT_ID or VERCEL_PROJECT_NAME)",
		);
		process.exitCode = 1;
		return;
	}
	log(">> Vercel Fix: project", projectId, "domain", apex);
	const ensureApex = await ensureDomainInProject(projectId, apex);
	const config = await getDomainConfig(apex);
	let records = [];
	let misconfigured = false;
	if (
		config?.data?.configured === false ||
		config?.data?.misconfigured === true ||
		config?.ok === false
	) {
		misconfigured = true;
		const recs = Array.isArray(config?.data?.records)
			? config.data.records
			: [];
		records = recs.map((r) => ({
			type: r?.type,
			name: r?.name,
			value: r?.value ?? r?.target,
			priority: r?.priority,
		}));
	}
	const verify = await verifyDomain(apex);
	const ensureWww = await ensureWwwRedirect(projectId, apex);
	const result = {
		ok: true,
		apex,
		projectId,
		ensureApex,
		ensureWww,
		configStatus: config?.status,
		configured: config?.data?.configured ?? null,
		misconfigured,
		requiredRecords: records,
		verifyStatus: verify?.status,
		verified: verify?.ok ?? null,
	};
	log(JSON.stringify(result));
}
if (process.argv[1] === import.meta.filename) {
	main().catch((e) => {
		process.stderr.write(String(e?.message ?? e) + "\n");
		process.exitCode = 1;
	});
}
