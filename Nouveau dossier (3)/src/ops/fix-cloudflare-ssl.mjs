import { loadEnv } from "../load-env.mjs";
import https from "node:https";

/**
 * FIX CLOUDFLARE SSL SETTINGS
 *
 * Attempts to use the Cloudflare API to force the correct SSL mode for 'realworldcerts.com'.
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env
 */
export async function fixCloudflareSsl() {
	console.log(">> ATTEMPTING CLOUDFLARE SSL REPAIR <<");
	loadEnv();

	const token = process.env.CLOUDFLARE_API_TOKEN;
	const zoneId = process.env.CLOUDFLARE_ZONE_ID;

	if (!token || !zoneId) {
		console.error(
			"❌ MISSING CREDENTIALS: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not found in .env",
		);
		console.log(
			"   -> Cannot automate fix. Please manually set SSL to 'Full (Strict)' in Cloudflare Dashboard.",
		);
		return;
	}

	// 1. Force SSL Mode to "Full (Strict)"
	// This is required because LearnWorlds serves HTTPS. If Cloudflare uses "Flexible", it causes loops or handshake errors.
	await updateSetting(zoneId, token, "ssl", { value: "strict" });

	// 2. Force Minimum TLS Version to 1.2
	// Modern browsers and payment gateways require this.
	await updateSetting(zoneId, token, "min_tls_version", { value: "1.2" });

	// 3. Always Use HTTPS
	await updateSetting(zoneId, token, "always_use_https", { value: "on" });

	console.log(">> CLOUDFLARE REPAIR COMMANDS SENT <<");
	console.log("   -> Allow 1-5 minutes for propagation.");
}

async function updateSetting(zoneId, token, settingName, body) {
	console.log(`[Cloudflare] Updating '${settingName}'...`);

	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: "api.cloudflare.com",
				path: `/client/v4/zones/${zoneId}/settings/${settingName}`,
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					if (res.statusCode === 200) {
						console.log(`[Cloudflare] SUCCESS: '${settingName}' updated.`);
						resolve(JSON.parse(data));
					} else {
						console.error(
							`[Cloudflare] FAILED: '${settingName}' - Status ${res.statusCode}`,
						);
						console.error(`   -> Response: ${data}`);
						resolve(null); // Resolve anyway to continue script
					}
				});
			},
		);

		req.on("error", (e) => {
			console.error(`[Cloudflare] NETWORK ERROR: ${e.message}`);
			resolve(null);
		});

		req.write(JSON.stringify(body));
		req.end();
	});
}

// Auto-execute if run directly
if (process.argv[1] === import.meta.filename) {
	fixCloudflareSsl();
}
