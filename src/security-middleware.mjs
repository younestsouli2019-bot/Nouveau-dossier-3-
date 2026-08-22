import { URL } from "url";

/**
 * Adds standard security headers to the response.
 * @param {import('http').ServerResponse} res
 */
export function addSecurityHeaders(res) {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self'; frame-ancestors 'none';",
	);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("X-XSS-Protection", "1; mode=block");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader(
		"Strict-Transport-Security",
		"max-age=63072000; includeSubDomains; preload",
	);
	// Additional defense-in-depth
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

/**
 * Validates authentication for protected endpoints.
 * @param {import('http').IncomingMessage} req
 * @param {string[]} validTokens
 * @returns {boolean} true if authorized
 */
export function validateAuth(req, validTokens) {
	if (!validTokens || validTokens.length === 0) return false;

	const authHeader = req.headers["authorization"];
	if (authHeader) {
		if (authHeader.startsWith("Bearer ")) {
			const token = authHeader.slice(7).trim();
			if (validTokens.includes(token)) return true;
		}
	}

	const apiKey = req.headers["x-api-key"] || req.headers["x-swarm-secret"];
	if (apiKey && validTokens.includes(apiKey)) return true;

	return false;
}

/**
 * Validates the request for common security issues.
 * Returns an error object if invalid, or null if valid.
 * @param {import('http').IncomingMessage} req
 * @returns {{ status: number, error: string } | null}
 */
export function validateRequest(req) {
	const urlStr = req.url || "/";

	// 1. Check for JWT/Token in URL (Base44 Vulnerability #3)
	if (/[?&](token|jwt|access_token|secret)=/i.test(urlStr)) {
		return {
			status: 400,
			error: "Sensitive data in URL parameters prohibited",
		};
	}

	// 2. Check for Open Redirect attempts
	// Looks for redirect_to=... or similar
	const redirectMatch = /[?&]redirect(?:_to|_uri|_url)?=([^&]+)/i.exec(urlStr);
	if (redirectMatch) {
		const target = decodeURIComponent(redirectMatch[1]);
		try {
			const u = new URL(target, "http://localhost"); // base required for relative URLs
			const hostname = u.hostname;
			// Allow localhost and your own domain (if defined)
			// Strictly block external domains unless whitelisted
			const allowed = ["localhost", "127.0.0.1"];
			if (process.env.ALLOWED_REDIRECT_DOMAINS) {
				allowed.push(
					...process.env.ALLOWED_REDIRECT_DOMAINS.split(",").map((s) =>
						s.trim(),
					),
				);
			}

			const isAllowed = allowed.some(
				(d) => hostname === d || hostname.endsWith("." + d),
			);
			if (!isAllowed) {
				return { status: 400, error: "Unvalidated redirect target" };
			}
		} catch {
			// If URL parsing fails but param exists, block it to be safe
			return { status: 400, error: "Invalid redirect target" };
		}
	}

	return null;
}

/**
 * Sanitizes input string to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeInput(str) {
	if (typeof str !== "string") return str;
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;")
		.replace(/\//g, "&#x2F;");
}

const INJECTION_PATTERNS = [
	{ re: /ignore\s+(all\s+)?(previous|prior)\s+(instructions|directives|prompts|context)/i, label: "ignore_previous" },
	{ re: /disregard\s+(all\s+)?(previous|prior)\s+(instructions|directives|prompts|context)/i, label: "disregard_previous" },
	{ re: /you\s+are\s+now\s+(an?\s+)?(unrestricted|jailbreak|developer\s+mode|free\s+mode)/i, label: "role_override" },
	{ re: /system\s*:\s*/i, label: "system_role_injection" },
	{ re: /reveal\s+(your\s+)?(system\s+)?(prompt|instructions|directives)/i, label: "reveal_prompt" },
	{ re: /(override|bypass|disable)\s+(the\s+)?(owner|allowlist|authority|directive)/i, label: "authority_bypass" },
	{ re: /add\s+(me|my\s+address|this\s+address)\s+to\s+(the\s+)?allowlist/i, label: "allowlist_injection" },
	{ re: /drain\s+(the\s+)?(account|wallet|balance|funds)/i, label: "drain_funds" },
	{ re: /transfer\s+(all\s+)?(funds|money|balance)\s+(out|away|to)/i, label: "fund_transfer_instruction" },
	{ re: /payout\s+(everything|all|everything\s+to)/i, label: "payout_all_instruction" },
];

/**
 * Detects prompt-injection / fund-diversion phrasing in a string or
 * recursively through an object's string values.
 * @param {*} value
 * @returns {{ matched: string, label: string, location: string } | null}
 */
export function detectPromptInjection(value, location = "body") {
	if (value == null) return null;
	if (typeof value === "string") {
		for (const { re, label } of INJECTION_PATTERNS) {
			if (re.test(value)) {
				return { matched: value.slice(0, 120), label, location };
			}
		}
		return null;
	}
	if (typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			const found = detectPromptInjection(child, `${location}.${key}`);
			if (found) return found;
		}
	}
	return null;
}

const PAYOUT_FIELD_KEYS = new Set([
	"recipient",
	"recipient_address",
	"recipient_email",
	"receiver",
	"beneficiary",
	"destination",
	"destination_address",
	"payout_destination",
	"address",
	"bank_account",
	"iban",
	"rib",
	"wallet_address",
	"paypal_email",
	"owner_recipient",
]);

/**
 * Extracts candidate payout-destination values from an object so callers can
 * verify each one is owner-approved (fund-diversion guard).
 * @param {*} value
 * @returns {Array<{ field: string, value: string, path: string }>}
 */
export function extractPayoutDestinations(value, path = "body") {
	const out = [];
	if (value == null) return out;
	if (typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			const k = String(key).toLowerCase();
			if (PAYOUT_FIELD_KEYS.has(k) && typeof child === "string" && child.trim()) {
				out.push({ field: k, value: child.trim(), path: `${path}.${key}` });
			}
			out.push(...extractPayoutDestinations(child, `${path}.${key}`));
		}
	}
	return out;
}

/**
 * Express-style middleware that rejects bodies whose payout-destination fields
 * are not in the supplied allowlist (normalized, case/space-insensitive).
 */
export function validateNoFundDiversion(allowlist) {
	const allowed = new Set(
		(allowlist || [])
			.map((x) =>
				String(x ?? "")
					.replace(/["']/g, "")
					.replace(/\s+/g, "")
					.toUpperCase(),
			)
			.filter(Boolean),
	);
	return (req, res, next) => {
		const body = req.body;
		if (body && typeof body === "object") {
			const targets = extractPayoutDestinations(body);
			for (const t of targets) {
				const norm = t.value.replace(/["']/g, "").replace(/\s+/g, "").toUpperCase();
				if (!allowed.has(norm)) {
					res.status(403).json({
						ok: false,
						error: "Fund_diversion_guard",
						field: t.path,
					});
					return;
				}
			}
		}
		next();
	};
}
