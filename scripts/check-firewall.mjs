import https from "https";

const endpoints = [
	"https://api-m.paypal.com/v1/oauth2/token", // Just checking reachability
	"https://agent-flow-ai-9855ea98.base44.app/api/health",
];

async function checkUrl(url) {
	return new Promise((resolve) => {
		const start = Date.now();
		const req = https.get(url, (res) => {
			const time = Date.now() - start;
			console.log(`✅ [${res.statusCode}] ${url} (${time}ms)`);
			res.resume();
			resolve(true);
		});

		req.on("error", (e) => {
			console.error(`❌ ERROR ${url}: ${e.message}`);
			resolve(false);
		});

		req.setTimeout(5000, () => {
			console.error(`❌ TIMEOUT ${url}`);
			req.destroy();
			resolve(false);
		});
	});
}

console.log("Starting Firewall Connectivity Check...");
console.log("---------------------------------------");

const results = await Promise.all(endpoints.map(checkUrl));

if (results.every((r) => r)) {
	console.log("\nAll critical endpoints are REACHABLE.");
	process.exit(0);
} else {
	console.log("\nSome endpoints are BLOCKED.");
	process.exit(1);
}
