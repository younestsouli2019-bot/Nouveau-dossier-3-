import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import "../load-env.mjs";
function env(name, fallback = "") {
	const v = process.env[name];
	return v == null ? fallback : String(v).trim();
}
function nowIso() {
	return new Date().toISOString();
}
function writeJson(p, obj) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function checkAdb() {
	try {
		const r = spawnSync("adb", ["version"], { stdio: "pipe" });
		return r.status === 0;
	} catch {
		return false;
	}
}
function adbGetprop(prop) {
	try {
		const r = spawnSync("adb", ["shell", "getprop", prop], { stdio: "pipe" });
		if (r.status === 0) return String(r.stdout || "").trim();
		return null;
	} catch {
		return null;
	}
}
function platformChecklist(platform) {
	const common = [
		"Enable full-disk encryption",
		"Require PIN/biometric with short lock timeout",
		"Disable installation from unknown sources",
		"Disable USB debugging",
		"Keep OS and apps updated",
		"Restrict notifications on lock screen",
		"Enable device find/remote wipe",
		"Harden browser: block third-party cookies, disable risky flags",
		"Use privacy DNS (DoH/DoT) if available",
		"Review app permissions and revoke unnecessary",
	];
	if (platform === "android") {
		return common.concat([
			"Enable Play Protect",
			"Disable OEM unlock",
			"Set strong SIM PIN",
			"Disable Wi-Fi auto-connect to open networks",
			"Disable Bluetooth visibility",
			"Block sideload via package installer policies",
		]);
	}
	if (platform === "ios") {
		return common.concat([
			"Enable Find My and Activation Lock",
			"Disable USB accessories while locked",
			"Limit AirDrop to Contacts Only",
			"Disable iCloud Keychain sync on shared devices",
			"Disable background app refresh for sensitive apps",
		]);
	}
	return common;
}
function androidTelemetry() {
	const adb = checkAdb();
	if (!adb) return { adb: false };
	const enc = adbGetprop("ro.crypto.state");
	const oem = adbGetprop("ro.oem_unlock_supported");
	const dbg = adbGetprop("ro.debuggable");
	const resp = {
		adb: true,
		properties: {
			ro_crypto_state: enc,
			ro_oem_unlock_supported: oem,
			ro_debuggable: dbg,
		},
	};
	return resp;
}
async function main() {
	const platform = env("MOBILE_PLATFORM", "android").toLowerCase();
	const checklist = platformChecklist(platform);
	const telemetry =
		platform === "android" ? androidTelemetry() : { adb: false };
	const result = {
		timestamp: nowIso(),
		platform,
		checklist,
		telemetry,
	};
	const outPath = path.resolve(
		process.cwd(),
		".swarm",
		"outgoing",
		`mobile-hardening-${Date.now()}.json`,
	);
	writeJson(outPath, result);
	process.stdout.write(
		JSON.stringify({ ok: true, outPath, platform, adb: telemetry.adb }) + "\n",
	);
}
if (process.argv[1] === import.meta.filename) {
	main().catch((e) => {
		process.stderr.write(String(e?.message ?? e) + "\n");
		process.exitCode = 1;
	});
}
