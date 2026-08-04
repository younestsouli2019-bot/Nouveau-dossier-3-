import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const DEFAULT_DIR = path.resolve("data/swarm/tasks");

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function newId() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

function readJson(file) {
	try {
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function writeJson(file, obj) {
	ensureDir(path.dirname(file));
	fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function taskPath(dir, id) {
	return path.join(dir, `${id}.task.json`);
}

function claimDirPath(dir, id) {
	return path.join(dir, `${id}.claim`);
}

function donePath(dir, id) {
	return path.join(dir, `${id}.done.json`);
}

function readClaim(dir, id) {
	const claimFile = path.join(claimDirPath(dir, id), "claim.json");
	return readJson(claimFile);
}

export class TaskQueue {
	constructor({ dir = process.env.TASK_QUEUE_DIR || DEFAULT_DIR, leaseMs = 300000 } = {}) {
		this.dir = dir;
		this.leaseMs = Number(process.env.TASK_QUEUE_LEASE_MS ?? leaseMs) || leaseMs;
		ensureDir(this.dir);
	}

	enqueue({ type, title, payload = {}, priority = 5 }) {
		if (!type) throw new Error("TaskQueue.enqueue requires a type");
		if (!title) throw new Error("TaskQueue.enqueue requires a title");
		const id = newId();
		const task = {
			id,
			type,
			title,
			payload,
			priority: Number(priority) || 5,
			createdAt: new Date().toISOString(),
			status: "queued",
		};
		writeJson(taskPath(this.dir, id), task);
		return task;
	}

	list({ status = null } = {}) {
		let ids = [];
		try {
			ids = fs.readdirSync(this.dir).filter((f) => f.endsWith(".task.json"));
		} catch {
			ids = [];
		}
		const tasks = [];
		for (const f of ids) {
			const task = readJson(path.join(this.dir, f));
			if (!task) continue;
			const done = readJson(donePath(this.dir, task.id));
			const claim = readClaim(this.dir, task.id);
			task.status = done ? (done.ok ? "done" : "failed") : claim ? "claimed" : "queued";
			if (status && task.status !== status) continue;
			tasks.push(task);
		}
		return tasks.sort((a, b) => a.priority - b.priority || String(a.createdAt).localeCompare(String(b.createdAt)));
	}

	stats() {
		const all = this.list();
		const counts = {};
		for (const t of all) counts[t.status] = (counts[t.status] ?? 0) + 1;
		return {
			total: all.length,
			counts,
			byType: all.reduce((acc, t) => {
				acc[t.type] = (acc[t.type] ?? 0) + 1;
				return acc;
			}, {}),
		};
	}

	get(id) {
		const task = readJson(taskPath(this.dir, id));
		if (!task) return null;
		const done = readJson(donePath(this.dir, id));
		const claim = readClaim(this.dir, id);
		task.status = done ? (done.ok ? "done" : "failed") : claim ? "claimed" : "queued";
		return task;
	}

	claim({ worker = `worker_${process.pid}`, leaseMs = this.leaseMs } = {}) {
		const candidates = this.list({ status: "queued" });
		for (const task of candidates) {
			const claimDir = claimDirPath(this.dir, task.id);
			try {
				fs.mkdirSync(claimDir, { recursive: false });
			} catch {
				continue;
			}
			writeJson(path.join(claimDir, "claim.json"), {
				worker,
				claimedAt: new Date().toISOString(),
				leaseUntil: new Date(Date.now() + leaseMs).toISOString(),
			});
			return this.get(task.id);
		}
		return null;
	}

	complete(id, { result = null } = {}) {
		const task = this.get(id);
		if (!task) throw new Error(`TaskQueue.complete: unknown task ${id}`);
		writeJson(donePath(this.dir, id), {
			ok: true,
			result,
			at: new Date().toISOString(),
		});
		this._releaseClaim(id);
		return this.get(id);
	}

	fail(id, { error = "unknown error" } = {}) {
		const task = this.get(id);
		if (!task) throw new Error(`TaskQueue.fail: unknown task ${id}`);
		writeJson(donePath(this.dir, id), {
			ok: false,
			error: String(error),
			at: new Date().toISOString(),
		});
		this._releaseClaim(id);
		return this.get(id);
	}

	reap(now = Date.now()) {
		let ids = [];
		try {
			ids = fs.readdirSync(this.dir).filter((f) => f.endsWith(".claim"));
		} catch {
			ids = [];
		}
		let released = 0;
		for (const claimName of ids) {
			const id = claimName.replace(/\.claim$/, "");
			if (readJson(donePath(this.dir, id))) {
				this._releaseClaim(id);
				released++;
				continue;
			}
			const claim = readClaim(this.dir, id);
			if (!claim) {
				this._releaseClaim(id);
				released++;
				continue;
			}
			const until = Date.parse(String(claim.leaseUntil ?? ""));
			if (Number.isNaN(until) || until < now) {
				this._releaseClaim(id);
				released++;
			}
		}
		return { released };
	}

	clear({ status = "done" } = {}) {
		const ids = this.list({ status }).map((t) => t.id);
		for (const id of ids) {
			for (const f of [taskPath(this.dir, id), donePath(this.dir, id)]) {
				try {
					fs.unlinkSync(f);
				} catch {}
			}
			this._releaseClaim(id);
		}
		return { cleared: ids.length };
	}

	_releaseClaim(id) {
		try {
			fs.rmSync(claimDirPath(this.dir, id), { recursive: true, force: true });
		} catch {}
	}
}

export function runCommand(cmd, args, { cwd = process.cwd(), timeoutMs = 300000 } = {}) {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			resolve({ ok: false, code: "TIMEOUT", stdout, stderr: `${stderr}\n[killed after ${timeoutMs}ms]` });
		}, timeoutMs);
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, code, stdout, stderr });
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			resolve({ ok: false, code: "SPAWN_ERROR", stdout, stderr: String(e?.message ?? e) });
		});
	});
}

export function gitCommand(args, { cwd = process.cwd() } = {}) {
	return runCommand("git", args, { cwd, timeoutMs: 180000 });
}

export default TaskQueue;
