function isPlaceholderValue(value) {
	if (value == null) return true;
	const v = String(value).trim();
	if (!v) return true;
	if (/^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$/i.test(v)) return true;
	if (/^\s*YOUR_[A-Z0-9_]+\s*$/i.test(v)) return true;
	if (/^\s*(REPLACE_ME|CHANGEME|TODO)\s*$/i.test(v)) return true;
	return false;
}

export function getEnvOrThrow(name) {
	const v = process.env[name];
	if (v == null || String(v).trim() === "")
		throw new Error(`Missing required env var: ${name}`);
	if (isPlaceholderValue(v))
		throw new Error(`Missing required env var: ${name}`);
	return v;
}

export function getEnvBool(name, defaultValue = false) {
	const v = process.env[name];
	if (v == null) return defaultValue;
	return v.toLowerCase() === "true";
}

export function getEnvNumber(name, defaultValue) {
	const v = Number(process.env[name]);
	if (!Number.isFinite(v)) return defaultValue;
	return v;
}

export function getHttpTimeoutMs() {
	const ms = Number(process.env.EDU_HTTP_TIMEOUT_MS ?? "10000");
	if (!ms || Number.isNaN(ms) || ms < 1000) return 10000;
	return ms;
}

export function liveModeGate(reason) {
	if (!getEnvBool("SWARM_LIVE", false)) {
		throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
	}
}

export async function eduFetch({ url, method = "GET", headers, body, timeoutMs, fetchImpl }) {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		timeoutMs ?? getHttpTimeoutMs(),
	);
	const useFetch = fetchImpl ?? fetch;
	let res;
	try {
		res = await useFetch(url, {
			method,
			headers: {
				Accept: "application/json",
				...(headers ?? {}),
			},
			...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`EDU request failed (${res.status}) ${method} ${url}: ${text.slice(0, 500)}`);
	}

	const contentType = res.headers.get("content-type") || "";
	if (contentType.includes("application/json")) return res.json();
	const text = await res.text().catch(() => "");
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
