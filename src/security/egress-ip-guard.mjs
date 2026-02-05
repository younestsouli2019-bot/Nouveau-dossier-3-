import fs from "fs";
import path from "path";
import https from "https";

function fetchIp(url) {
	return new Promise((resolve, reject) => {
		try {
			const req = https.get(url, (res) => {
				const chunks = [];
				res.on("data", (d) => chunks.push(d));
				res.on("end", () => {
					const buf = Buffer.concat(chunks);
					resolve(buf.toString("utf8").trim());
				});
			});
			req.on("error", (e) => reject(e));
			req.setTimeout(8000, () => req.destroy(new Error("timeout")));
		} catch (e) {
			reject(e);
		}
	});
}

export async function getPublicIp() {
	const sources = [
		"https://api.ipify.org",
		"https://ifconfig.me/ip",
		"https://ipv4.icanhazip.com",
	];
	for (const u of sources) {
		try {
			const ip = await fetchIp(u);
			if (ip && ip.length >= 7) return ip;
		} catch {}
	}
	return null;
}

export async function checkEgressIp(expected) {
	const exp = String(expected || process.env.EXPECTED_EGRESS_IP || "").trim();
	const current = await getPublicIp();
	const ok = exp ? current === exp : true;
	return { ok, current, expected: exp };
}

export async function writeEgressStatus(
	filePath = "data/notifications/egress-ip.json",
) {
	const p = path.resolve(filePath);
	const status = await checkEgressIp();
	const out = { created_at: new Date().toISOString(), ...status };
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(out, null, 2));
	return p;
}
