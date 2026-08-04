import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TaskQueue, { runCommand } from "../src/task-queue.mjs";
import TaskOrchestrator, { resolveHandler } from "../src/task-orchestrator.mjs";

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "tqtest-"));
}

describe("task-queue.mjs", () => {
	let dir;
	let q;
	beforeEach(() => {
		dir = tempDir();
		q = new TaskQueue({ dir, leaseMs: 500 });
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("enqueues tasks in queued status", () => {
		const t = q.enqueue({ type: "run-tests", title: "Run suite" });
		assert.ok(t.id);
		assert.ok(t.status === "queued");
		assert.ok(q.stats().total === 1);
	});

	it("requires type and title", () => {
		assert.throws(() => q.enqueue({ title: "x" }), /type/);
		assert.throws(() => q.enqueue({ type: "x" }), /title/);
	});

	it("claims tasks exactly once", () => {
		q.enqueue({ type: "a", title: "one" });
		q.enqueue({ type: "b", title: "two" });
		const c1 = q.claim({ worker: "A" });
		const c2 = q.claim({ worker: "B" });
		assert.ok(c1.id !== c2.id);
		assert.ok(c1.status === "claimed");
		assert.ok(q.get(c1.id).status === "claimed");
		assert.ok(q.claim({ worker: "C" }) === null);
	});

	it("complete marks done and releases claim", () => {
		const t = q.enqueue({ type: "a", title: "one" });
		q.claim({ worker: "A" });
		const done = q.complete(t.id, { result: "ok" });
		assert.ok(done.status === "done");
		assert.ok(q.stats().counts.done === 1);
	});

	it("fail marks failed with error", () => {
		const t = q.enqueue({ type: "a", title: "one" });
		q.claim({ worker: "A" });
		const failed = q.fail(t.id, { error: "boom" });
		assert.ok(failed.status === "failed");
		assert.ok(q.stats().counts.failed === 1);
	});

	it("reap requeues expired leases", () => {
		const t = q.enqueue({ type: "a", title: "one" });
		q.claim({ worker: "A", leaseMs: 50 });
		const reaped = q.reap(Date.now() + 10000);
		assert.ok(reaped.released === 1);
		assert.ok(q.get(t.id).status === "queued");
	});

	it("does not reap a live lease", () => {
		const t = q.enqueue({ type: "a", title: "one" });
		q.claim({ worker: "A", leaseMs: 60000 });
		assert.ok(q.reap().released === 0);
		assert.ok(q.get(t.id).status === "claimed");
	});

	it("clear removes done tasks", () => {
		const t = q.enqueue({ type: "a", title: "one" });
		q.claim({ worker: "A" });
		q.complete(t.id, { result: "ok" });
		const out = q.clear();
		assert.ok(out.cleared === 1);
		assert.ok(q.stats().total === 0);
	});

	it("lists by status filter", () => {
		const t1 = q.enqueue({ type: "a", title: "one" });
		q.enqueue({ type: "b", title: "two" });
		q.claim({ worker: "A" });
		q.complete(t1.id, { result: "ok" });
		assert.ok(q.list({ status: "done" }).length === 1);
		assert.ok(q.list({ status: "queued" }).length === 1);
	});
});

describe("task-orchestrator.mjs", () => {
	let dir;
	let q;
	beforeEach(() => {
		dir = tempDir();
		q = new TaskQueue({ dir, leaseMs: 500 });
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("resolveHandler maps known types", () => {
		const h = resolveHandler({ type: "run-tests", payload: {} });
		assert.ok(h && h.script === process.execPath);
		assert.ok(Array.isArray(h.args));
	});

	it("resolveHandler falls back to payload command", () => {
		const h = resolveHandler({ type: "custom", payload: { command: "node --version" } });
		assert.ok(h && h.script === "node");
		assert.ok(h.args.join(" ") === "--version");
	});

	it("resolveHandler returns null for unknown types", () => {
		assert.ok(resolveHandler({ type: "nope", payload: {} }) === null);
	});

	it("processOnce runs a task to completion", async () => {
		q.enqueue({ type: "run-tests", title: "Run suite", payload: { testFile: "test/courseFactory.test.mjs" } });
		const orch = new TaskOrchestrator({ queue: q, worker: "test_worker" });
		const out = await orch.processOnce({ max: 1 });
		assert.ok(out.claimed.length === 1);
		assert.ok(q.stats().counts.done === 1);
	});

	it("processOnce fails unhandled tasks", async () => {
		q.enqueue({ type: "unknown_type", title: "Weird", payload: {} });
		const orch = new TaskOrchestrator({ queue: q, worker: "test_worker" });
		const out = await orch.processOnce({ max: 1 });
		assert.ok(out.skipped.length === 1);
		assert.ok(q.stats().counts.failed === 1);
	});

	it("processOnce with max 0 claims nothing", async () => {
		q.enqueue({ type: "run-tests", title: "Run suite", payload: {} });
		const orch = new TaskOrchestrator({ queue: q, worker: "test_worker" });
		const out = await orch.processOnce({ max: 0 });
		assert.ok(out.claimed.length === 0);
	});
});

describe("runCommand", () => {
	it("runs a command and captures output", async () => {
		const res = await runCommand(process.execPath, ["--version"]);
		assert.ok(res.ok);
		assert.ok(res.stdout.includes("v"));
	});

	it("captures a failing command", async () => {
		const res = await runCommand(process.execPath, ["-e", "process.exit(3)"]);
		assert.ok(res.ok === false);
		assert.ok(res.code === 3);
	});
});
