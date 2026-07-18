import https from "node:https";
import http from "node:http";
import { maybeSendAlert } from "../alerts.mjs";

export class SiteWatchAgent {
	constructor(domain = "www.realworldcerts.com") {
		this.domain = domain;
		this.lastCheck = 0;
		this.checkInterval = 3600000; // 1 hour
	}

	async run(now = Date.now()) {
		if (now - this.lastCheck < this.checkInterval)
			return { ok: true, skipped: true };
		this.lastCheck = now;

		console.log(`[SiteWatch] Checking https://${this.domain}...`);

		return new Promise((resolve) => {
			const req = https.request(
				{
					hostname: this.domain,
					port: 443,
					path: "/",
					method: "GET",
					timeout: 10000,
					rejectUnauthorized: true, // Fail on SSL errors
				},
				(res) => {
					if (res.statusCode >= 400) {
						const msg = `SiteWatch Alert: ${this.domain} returned ${res.statusCode}`;
						console.error(`[SiteWatch] Error: ${res.statusCode}`);
						maybeSendAlert(msg);
						resolve({ ok: false, error: msg });
					} else {
						console.log(`[SiteWatch] OK: ${res.statusCode}`);
						resolve({ ok: true, status: res.statusCode });
					}
					res.resume();
				},
			);

			req.on("error", (e) => {
				console.error(`[SiteWatch] HTTPS failed: ${e.message}`);
				if (String(process.env.SITEWATCH_FALLBACK_HTTP ?? "true").toLowerCase() === "true") {
					const apex = "realworldcerts.com";
					console.log(`[SiteWatch] Falling back to http://${apex}...`);
					const hreq = http.request(
						{
							hostname: apex,
							port: 80,
							path: "/",
							method: "GET",
							timeout: 8000
						},
						(hres) => {
							console.log(`[SiteWatch] HTTP fallback status: ${hres.statusCode}`);
							resolve({ ok: true, fallback: "http", status: hres.statusCode });
							hres.resume();
						}
					);
					hreq.on("error", (he) => {
						const msg = `SiteWatch Critical: Fallback failed - ${he.message}`;
						console.error(`[SiteWatch] Fallback connection failed: ${he.message}`);
						maybeSendAlert(msg);
						resolve({ ok: false, error: msg });
					});
					hreq.end();
					return;
				}
				const msg = `SiteWatch Critical: ${this.domain} failed - ${e.message}`;
				console.error(`[SiteWatch] Connection failed: ${e.message}`);
				maybeSendAlert(msg);
				resolve({ ok: false, error: msg });
			});

			req.end();
		});
	}
}
