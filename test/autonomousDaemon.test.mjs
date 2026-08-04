import test from "node:test";
import assert from "node:assert/strict";

import {
	resolveRuntimeConfig,
	maybeRunTaskQueue,
} from "../src/autonomous-daemon.mjs";
import { TaskQueue } from "../src/task-queue.mjs";

test("resolveRuntimeConfig enables create payout batches from CLI flag", () => {
	const cfg = resolveRuntimeConfig({ "create-payout-batches": true }, {});
	assert.equal(cfg.tasks.createPayoutBatches, true);
});

test("resolveRuntimeConfig enables auto approve batches when auto approve payouts enabled", () => {
	const cfg = resolveRuntimeConfig({ "auto-approve-payouts": true }, {});
	assert.equal(cfg.payout.autoApprove.enabled, true);
	assert.equal(cfg.tasks.autoApprovePayoutBatches, true);
});

test("resolveRuntimeConfig enables auto submit PayPal from env", () => {
	const prev = process.env.AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES;
	try {
		process.env.AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES = "true";
		const cfg = resolveRuntimeConfig({}, {});
		assert.equal(cfg.tasks.autoSubmitPayPalPayoutBatches, true);
	} finally {
		if (prev == null)
			delete process.env.AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES;
		else process.env.AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES = prev;
	}
});

test("resolveRuntimeConfig enables auto export Payoneer from env", () => {
	const prev = process.env.AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES;
	try {
		process.env.AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES = "true";
		const cfg = resolveRuntimeConfig({}, {});
		assert.equal(cfg.tasks.autoExportPayoneerPayoutBatches, true);
	} finally {
		if (prev == null)
			delete process.env.AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES;
		else process.env.AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES = prev;
	}
});

test("resolveRuntimeConfig reads Payoneer out dir from env", () => {
	const prev = process.env.AUTONOMOUS_PAYONEER_OUT_DIR;
	try {
		process.env.AUTONOMOUS_PAYONEER_OUT_DIR = "custom/payoneer";
		const cfg = resolveRuntimeConfig({}, {});
		assert.equal(cfg.payout.export.payoneerOutDir, "custom/payoneer");
	} finally {
		if (prev == null) delete process.env.AUTONOMOUS_PAYONEER_OUT_DIR;
		else process.env.AUTONOMOUS_PAYONEER_OUT_DIR = prev;
	}
});

test("resolveRuntimeConfig enables task queue from CLI flag", () => {
	const cfg = resolveRuntimeConfig({ "task-queue": true }, {});
	assert.equal(cfg.tasks.taskQueue, true);
});

test("resolveRuntimeConfig enables task queue from env", () => {
	const prev = process.env.AUTONOMOUS_TASK_QUEUE;
	try {
		process.env.AUTONOMOUS_TASK_QUEUE = "true";
		const cfg = resolveRuntimeConfig({}, {});
		assert.equal(cfg.tasks.taskQueue, true);
		assert.equal(cfg.taskQueue.intervalMs, 60000);
		assert.equal(cfg.taskQueue.maxPerTick, 1);
		assert.equal(cfg.taskQueue.pull, false);
	} finally {
		if (prev == null) delete process.env.AUTONOMOUS_TASK_QUEUE;
		else process.env.AUTONOMOUS_TASK_QUEUE = prev;
	}
});

test("resolveRuntimeConfig reads task queue interval and max per tick from env", () => {
	const prevInt = process.env.AUTONOMOUS_TASK_QUEUE_INTERVAL_MS;
	const prevMax = process.env.AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK;
	const prevPull = process.env.AUTONOMOUS_TASK_QUEUE_PULL;
	try {
		process.env.AUTONOMOUS_TASK_QUEUE_INTERVAL_MS = "30000";
		process.env.AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK = "3";
		process.env.AUTONOMOUS_TASK_QUEUE_PULL = "true";
		const cfg = resolveRuntimeConfig({ "task-queue": true }, {});
		assert.equal(cfg.taskQueue.intervalMs, 30000);
		assert.equal(cfg.taskQueue.maxPerTick, 3);
		assert.equal(cfg.taskQueue.pull, true);
	} finally {
		if (prevInt == null)
			delete process.env.AUTONOMOUS_TASK_QUEUE_INTERVAL_MS;
		else process.env.AUTONOMOUS_TASK_QUEUE_INTERVAL_MS = prevInt;
		if (prevMax == null)
			delete process.env.AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK;
		else process.env.AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK = prevMax;
		if (prevPull == null) delete process.env.AUTONOMOUS_TASK_QUEUE_PULL;
		else process.env.AUTONOMOUS_TASK_QUEUE_PULL = prevPull;
	}
});

test("resolveRuntimeConfig task queue disabled by default", () => {
	const cfg = resolveRuntimeConfig({}, {});
	assert.equal(cfg.tasks.taskQueue, false);
});

test("maybeRunTaskQueue skips when task queue disabled", async () => {
	const cfg = {
		tasks: { taskQueue: false },
		taskQueue: { intervalMs: 1, maxPerTick: 1, pull: false },
		offline: { enabled: false },
	};
	const r = await maybeRunTaskQueue(cfg, {});
	assert.equal(r.ok, true);
	assert.equal(r.skipped, true);
	assert.equal(r.reason, "disabled");
});

test("maybeRunTaskQueue skips in offline mode", async () => {
	const cfg = {
		tasks: { taskQueue: true },
		taskQueue: { intervalMs: 1, maxPerTick: 1, pull: false },
		offline: { enabled: true },
	};
	const r = await maybeRunTaskQueue(cfg, {});
	assert.equal(r.ok, true);
	assert.equal(r.skipped, true);
	assert.equal(r.reason, "offline");
});

test("maybeRunTaskQueue processes a queued task", async () => {
	const cfg = {
		tasks: { taskQueue: true },
		taskQueue: { intervalMs: 1, maxPerTick: 1, pull: false },
		offline: { enabled: false },
	};
	const q = new TaskQueue();
	q.enqueue({ type: "run-tests", title: "daemon integration test", payload: { testFile: "test/taskQueue.test.mjs" } });
	const state = {};
	const r = await maybeRunTaskQueue(cfg, state, q);
	assert.equal(r.ok, true);
	assert.equal(Array.isArray(r.claimed), true);
	assert.equal(r.claimed.length, 1);
	assert.ok(state.lastTaskQueueAt > 0);
	q.clear();
});
