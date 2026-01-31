export class IdempotentExecutor {
	constructor() {
		this.cache = new Map();
	}
	async execute(key, fn, context) {
		const k = String(key || "");
		if (this.cache.has(k)) return this.cache.get(k);
		const res = await fn();
		this.cache.set(k, res);
		return res;
	}
}
