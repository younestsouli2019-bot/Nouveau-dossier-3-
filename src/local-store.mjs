import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// A simple, robust JSON-based local database to replace Base44
export class LocalSwarmStore {
	constructor(baseDir = "data/local_swarm") {
		this.baseDir = path.resolve(baseDir);
		this.collections = {};
	}

	async init() {
		await fs.mkdir(this.baseDir, { recursive: true });
		const entities = [
			"RevenueEvent",
			"PayoutBatch",
			"TransactionLog",
			"Agents",
			"Missions",
		];
		for (const e of entities) {
			await fs.mkdir(path.join(this.baseDir, e), { recursive: true });
		}
	}

	// CRUD Operations mirroring Base44 structure
	async create(entity, data) {
		const id = data.id || crypto.randomUUID();
		const doc = { ...data, id, created_at: new Date().toISOString() };
		const filePath = path.join(this.baseDir, entity, `${id}.json`);
		await fs.writeFile(filePath, JSON.stringify(doc, null, 2));
		return doc;
	}

	async list(entity, filterFn = null) {
		const dir = path.join(this.baseDir, entity);
		try {
			const files = await fs.readdir(dir);
			const docs = [];
			for (const f of files) {
				if (!f.endsWith(".json")) continue;
				const content = await fs.readFile(path.join(dir, f), "utf8");
				try {
					const doc = JSON.parse(content);
					if (!filterFn || filterFn(doc)) {
						docs.push(doc);
					}
				} catch {}
			}
			return docs.sort(
				(a, b) => new Date(b.created_at) - new Date(a.created_at),
			);
		} catch {
			return [];
		}
	}

	async update(entity, id, updates) {
		const filePath = path.join(this.baseDir, entity, `${id}.json`);
		try {
			const content = await fs.readFile(filePath, "utf8");
			const doc = JSON.parse(content);
			const newDoc = {
				...doc,
				...updates,
				updated_at: new Date().toISOString(),
			};
			await fs.writeFile(filePath, JSON.stringify(newDoc, null, 2));
			return newDoc;
		} catch {
			return null;
		}
	}
}
