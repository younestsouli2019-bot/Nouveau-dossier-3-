import fs from "node:fs/promises";
import path from "node:path";

export class SwarmMemory {
	constructor() {
		this.baseDir = path.resolve("data/swarm");
	}

	async init() {
		await fs.mkdir(this.baseDir, { recursive: true });
	}

	async read(key) {
		try {
			const filePath = path.join(this.baseDir, `${key}.json`);
			const data = await fs.readFile(filePath, "utf8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	}

	async write(key, data) {
		await this.init();
		const filePath = path.join(this.baseDir, `${key}.json`);
		await fs.writeFile(filePath, JSON.stringify(data, null, 2));
	}

	async appendLog(logEntry) {
		// Append-only log for audit
		const logPath = path.join(this.baseDir, "swarm.log");
		const line =
			JSON.stringify({ ...logEntry, _t: new Date().toISOString() }) + "\n";
		await fs.appendFile(logPath, line);
	}
}
