/**
 * BankingCircleGateway (VERIFY-ONLY / READ-ONLY)
 *
 * Implements Banking Circle B2B connectivity verification ONLY. It performs
 * the two read-only half of the agentic connection flow:
 *
 *   Phase 1 — Environment discovery / base-URL mapping.
 *   Phase 2 — mTLS-secured OAuth2 client-credentials token fetch.
 *   Phase 3 — Read-only capability/connectivity check (token + account/profile
 *             lookup). NEVER submits a payment.
 *
 * This module deliberately has NO executeTransfer / send path. Initiating a real
 * bank-send (pain.001) is out of scope: it is gated by the money invariants and
 * requires a live, funded, authenticated rail PLUS the existing SWARM_LIVE /
 * BANKING_CIRCLE_ENABLE guards. This class only proves the credential and
 * connectivity so the rail-health audit can mark the route "deliverable".
 *
 * Environment variables:
 *   BANKING_CIRCLE_CLIENT_ID      - OAuth2 client id
 *   BANKING_CIRCLE_CLIENT_SECRET  - OAuth2 client secret
 *   BANKING_CIRCLE_CERT           - path to mTLS client cert (.crt/.pem)
 *   BANKING_CIRCLE_KEY            - path to mTLS client private key (.key)
 *   BANKING_CIRCLE_SANDBOX        - "true" to use sandbox endpoints (default true)
 *   BANKING_CIRCLE_AUTH_BASE      - override auth base URL
 *   BANKING_CIRCLE_DATA_BASE      - override data base URL
 *   SWARM_LIVE                    - "true" required (matches repo gateway guards)
 *   BANKING_CIRCLE_ENABLE         - "true" required
 *
 * Returns a report; on any failure it throws (fail-closed) with the reason.
 */
import fs from "node:fs";

const PROD = {
	auth: "https://authorization.bankingcircleconnect.com",
	data: "https://bankingcircleconnect.com",
};

const SANDBOX = {
	auth: "https://authorizationsandbox.bankingcircleconnect.com",
	data: "https://sandbox.bankingcircleconnect.com",
};

export class BankingCircleGateway {
	constructor({ sandbox = process.env.BANKING_CIRCLE_SANDBOX } = {}) {
		this.sandbox = String(sandbox || "true").toLowerCase() !== "false";
	}

	baseUrls() {
		const auth =
			String(process.env.BANKING_CIRCLE_AUTH_BASE || "").trim() ||
			(this.sandbox ? SANDBOX.auth : PROD.auth);
		const data =
			String(process.env.BANKING_CIRCLE_DATA_BASE || "").trim() ||
			(this.sandbox ? SANDBOX.data : PROD.data);
		return {
			env: this.sandbox ? "sandbox" : "production",
			authUrl: auth.replace(/\/+$/, ""),
			dataUrl: data.replace(/\/+$/, ""),
		};
	}

	ensureReady() {
		const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled =
			String(process.env.BANKING_CIRCLE_ENABLE || "false").toLowerCase() === "true";
		if (!live) throw new Error("BankingCircleGateway: SWARM_LIVE=true required");
		if (!enabled)
			throw new Error("BankingCircleGateway: BANKING_CIRCLE_ENABLE=true required");

		const client_id = process.env.BANKING_CIRCLE_CLIENT_ID || "";
		const client_secret = process.env.BANKING_CIRCLE_CLIENT_SECRET || "";
		const cert = process.env.BANKING_CIRCLE_CERT || "";
		const key = process.env.BANKING_CIRCLE_KEY || "";
		if (!client_id || !client_secret)
			throw new Error("BankingCircleGateway: missing BANKING_CIRCLE_CLIENT_ID/CLIENT_SECRET");
		if (!cert || !key)
			throw new Error("BankingCircleGateway: missing BANKING_CIRCLE_CERT/KEY (mTLS)");
		for (const p of [cert, key]) {
			if (!fs.existsSync(p))
				throw new Error(`BankingCircleGateway: mTLS file not found: ${p}`);
		}
		return { client_id, client_secret, cert, key };
	}

	async fetchToken({ client_id, client_secret, cert, key, authUrl }) {
		const body = new URLSearchParams({
			grant_type: "client_credentials",
			client_id,
			client_secret,
		});
		const res = await fetch(authUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			// mTLS: undici (Node >=18 task) accepts Buffers under `cert`/`key`.
			cert: fs.readFileSync(cert),
			key: fs.readFileSync(key),
			signal: AbortSignal.timeout(15000),
		});
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = { raw: text };
		}
		if (!res.ok) {
			throw new Error(
				`BankingCircleGateway token fetch failed ${res.status}: ${text.slice(0, 400)}`,
			);
		}
		const token = json?.access_token || json?.token || json?.accessToken;
		if (!token) throw new Error("BankingCircleGateway: no access_token returned");
		return token;
	}

	async verifyConnectivity({ token, dataUrl }) {
		// Read-only: tolerant probe of the data service that only confirms the
		// bearer token is accepted + account context is reachable. No payment
		// side effects. Probe order is best-effort; the first non-auth-failure
		// response is reported (404 just means the exact path differs by product).
		const probes = ["/v1/accounts", "/v1/status", "/", "/contactservice/v1/accounts"];
		let last = null;
		for (const path of probes) {
			const headers = {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			};
			let res;
			try {
				res = await fetch(`${dataUrl}${path}`, {
					method: "GET",
					headers,
					signal: AbortSignal.timeout(15000),
				});
			} catch (e) {
				last = { path, error: String(e?.message || e).slice(0, 200) };
				continue;
			}
			let json = null;
			const text = await res.text();
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				json = { raw: text.slice(0, 300) };
			}
			last = { path, statusCode: res.status, ok: res.ok, body: json };
			if (res.status !== 401 && res.status !== 403 && res.ok) break;
		}
		const ok = last && last.statusCode && last.statusCode >= 200 && last.statusCode < 300;
		return {
			ok: Boolean(ok),
			probe: last,
			note: "Token authenticated; exact account path is product-specific.",
		};
	}

	async verify() {
		const creds = this.ensureReady();
		const urls = this.baseUrls();
		const token = await this.fetchToken({ ...creds, authUrl: urls.authUrl });
		const conn = await this.verifyConnectivity({ token, dataUrl: urls.dataUrl });
		return {
			ok: conn.ok,
			environment: urls.env,
			authUrl: urls.authUrl,
			dataUrl: urls.dataUrl,
			tokenAcquired: true,
			capabilityProbe: conn,
			note: "READ-ONLY connectivity+credential verification. No payment submitted.",
		};
	}
}