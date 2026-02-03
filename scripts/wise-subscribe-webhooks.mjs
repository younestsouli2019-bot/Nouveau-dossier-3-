import { parseArgs } from "../src/utils/cli.mjs";

function isPlaceholder(v) {
	if (v == null) return true;
	const s = String(v).trim();
	if (!s) return true;
	if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
	if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
	return false;
}

function getEnv(name) {
	const v = process.env[name];
	if (v == null) return null;
	const s = String(v).trim();
	return s || null;
}

function getBaseUrl() {
	const sandbox =
		String(process.env.WISE_ENV ?? "live").toLowerCase() === "sandbox";
	return sandbox
		? "https://api.wise-sandbox.com"
		: "https://api.transferwise.com";
}

async function subscribe({ clientKey, token, url, trigger }) {
	const body = {
		name: `Webhook ${trigger}`,
		trigger_on: trigger,
		delivery: { version: "2.0.0", url },
	};
	const base = getBaseUrl();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10000);
	try {
		const res = await fetch(
			`${base}/v3/applications/${encodeURIComponent(clientKey)}/subscriptions`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			},
		);
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`Wise subscribe failed (${res.status}): ${text}`);
		}
		return text;
	} finally {
		clearTimeout(timeout);
	}
}

async function main() {
	const args = parseArgs(process.argv);
	const clientKey =
		args["client-key"] ?? getEnv("WISE_CLIENT_KEY") ?? getEnv("WISE_CLIENT_ID");
	const token = args.token ?? getEnv("OWNER_WISE_API_TOKEN") ?? getEnv("WISE_TOKEN");
	const url =
		args.url ?? getEnv("WISE_WEBHOOK_URL") ?? "https://hooks.realworldcerts.com/callback";
	if (isPlaceholder(clientKey)) throw new Error("Missing client key");
	if (isPlaceholder(token)) throw new Error("Missing Wise API token");
	if (!/^https:\/\//i.test(String(url))) throw new Error("Webhook URL must be HTTPS");
	const triggers = String(
		args.events ?? getEnv("WISE_WEBHOOK_EVENTS") ?? "transfers#state-change,balances#credit,transfers#issue",
	)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const results = [];
	for (const t of triggers) {
		try {
			const r = await subscribe({ clientKey, token, url, trigger: t });
			results.push({ trigger: t, ok: true, response: r });
		} catch (e) {
			results.push({ trigger: t, ok: false, error: String(e?.message ?? e) });
		}
	}
	process.stdout.write(JSON.stringify({ ok: true, results }, null, 2) + "\n");
}

main().catch((e) => {
	process.stderr.write(String(e?.message ?? e) + "\n");
	process.exitCode = 1;
});
