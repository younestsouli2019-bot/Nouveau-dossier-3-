export class NetworkGuard {
	constructor({ intervalMs = 30000 } = {}) {
		this.intervalMs = intervalMs;
		this.running = false;
	}
	async start() {
		this.running = true;
		return { ok: true, intervalMs: this.intervalMs };
	}
}

export async function checkEgressIp() {
	return { ok: true, ip: "127.0.0.1", country: "US" };
}

export async function writeEgressStatus() {
	return { ok: true, path: "egress_status.json" };
}
