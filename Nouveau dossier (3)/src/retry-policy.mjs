export class CircuitBreaker {
	constructor(opts = {}) {
		this.failureThreshold = opts.failureThreshold ?? 5;
		this.successThreshold = opts.successThreshold ?? 2;
		this.timeoutMs = opts.timeoutMs ?? 30000;
		this.state = "CLOSED";
		this.failures = 0;
		this.successes = 0;
		this.openedAt = 0;
	}
	isOpen() {
		if (this.state === "OPEN") {
			if (Date.now() - this.openedAt >= this.timeoutMs) {
				this.state = "HALF_OPEN";
				this.failures = 0;
				this.successes = 0;
				return false;
			}
			return true;
		}
		return false;
	}
	beforeCall() {
		if (this.isOpen()) {
			const err = new Error("CircuitBreakerOpen");
			err.code = "CIRCUIT_OPEN";
			throw err;
		}
	}
	onSuccess() {
		if (this.state === "HALF_OPEN") {
			this.successes += 1;
			if (this.successes >= this.successThreshold) {
				this.state = "CLOSED";
				this.failures = 0;
				this.successes = 0;
			}
		} else {
			this.failures = 0;
		}
	}
	onFailure() {
		if (this.state === "HALF_OPEN") {
			this.state = "OPEN";
			this.openedAt = Date.now();
			this.failures = 1;
			this.successes = 0;
			return;
		}
		this.failures += 1;
		if (this.failures >= this.failureThreshold) {
			this.state = "OPEN";
			this.openedAt = Date.now();
			this.successes = 0;
		}
	}
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export function defaultRetryClassifier(errOrRes) {
	const t =
		typeof errOrRes === "string" ? errOrRes : JSON.stringify(errOrRes ?? "");
	const s = String(t).toLowerCase();
	if (s.includes("enotfound")) return true;
	if (s.includes("econnrefused")) return true;
	if (s.includes("etimedout")) return true;
	if (s.includes("socket hang up")) return true;
	if (s.includes("network")) return true;
	if (s.includes("rate limit")) return true;
	if (s.includes("429")) return true;
	return false;
}

export async function retryWithPolicy(fn, opts = {}) {
	const attempts = Math.max(1, Number(opts.attempts ?? 3));
	const baseMs = Math.max(100, Number(opts.baseMs ?? 500));
	const maxMs = Math.max(baseMs, Number(opts.maxMs ?? 30000));
	const jitter = Math.min(1, Math.max(0, Number(opts.jitter ?? 0.2)));
	const classify =
		typeof opts.classify === "function"
			? opts.classify
			: defaultRetryClassifier;
	const cb = opts.circuitBreaker ?? null;

	let lastErr = null;
	for (let i = 0; i < attempts; i++) {
		try {
			if (cb) cb.beforeCall();
			const out = await fn();
			if (cb) cb.onSuccess();
			return out;
		} catch (e) {
			lastErr = e;
			if (cb) cb.onFailure();
			const retryable = classify(e?.message ?? String(e));
			if (!retryable || i === attempts - 1) throw e;
			const exp = Math.min(8, Math.pow(2, i));
			const raw = Math.min(maxMs, Math.max(baseMs, Math.floor(baseMs * exp)));
			const wiggle = Math.floor(raw * jitter * (Math.random() * 2 - 1));
			const delay = Math.max(50, raw + wiggle);
			await sleep(delay);
		}
	}
	if (lastErr) throw lastErr;
	return null;
}
