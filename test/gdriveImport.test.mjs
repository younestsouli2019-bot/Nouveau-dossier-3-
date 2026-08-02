import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GDrivePrepTestImporter } from "../src/edu/gdrive-import.mjs";

describe("GDrivePrepTestImporter", () => {
	let tmpDir;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdrive-test-"));
		process.env.GDRIVE_ENABLED = "false";
	});

	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		delete process.env.GDRIVE_ENABLED;
	});

	it("dry-runs folder listing when disabled", async () => {
		const importer = new GDrivePrepTestImporter({
			credentials: null,
			fetchImpl: async () =>
				new Response(JSON.stringify({ files: [{ id: "f1", name: "test.pdf" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		});
		importer.token = "fake-token";
		const result = await importer.importFolder({ folderId: "folder-1", destDir: tmpDir, courseName: "math" });
		assert.strictEqual(result.dryRun, true);
		assert.strictEqual(result.count, 1);
		assert.strictEqual(result.courseName, "math");
	});

	it("downloads files when enabled", async () => {
		process.env.GDRIVE_ENABLED = "true";
		const importer = new GDrivePrepTestImporter({
			credentials: null,
			fetchImpl: async (url, opts) => {
				if (url.includes("files?q=")) {
					return new Response(JSON.stringify({ files: [{ id: "f1", name: "test.pdf", mimeType: "application/pdf" }] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response("FAKE-PDF-BYTES", {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				});
			},
		});
		importer.token = "fake-token";
		const result = await importer.importFolder({ folderId: "folder-1", destDir: tmpDir, courseName: "math" });
		assert.strictEqual(result.dryRun, false);
		assert.strictEqual(result.count, 1);
		assert.ok(fs.existsSync(result.destDir));
		const files = fs.readdirSync(result.destDir);
		assert.ok(files.some((f) => f.startsWith("test.pdf")));
	});
});
