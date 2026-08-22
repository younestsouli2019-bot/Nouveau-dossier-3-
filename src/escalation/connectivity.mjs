import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const STATE_DIR = () => path.resolve(process.cwd(), "data", "escalation", "state");
const STATE_FILE = () => path.join(STATE_DIR(), "connectivity.json");

const DEFAULT_PROBES = () => {
	const cfg = [];
	const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
	if (smtpHost) cfg.push({ name: "smtp", host: smtpHost, port: Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587) });
	cfg.push({ name: "dns", host: "1.1.1.1", port: 443 });
	cfg.push({ name: "dns2", host: "8.8.8.8", port: 53 });
	return cfg;
};

function ensureDir() {
	fs.mkdirSync(STATE_DIR(), { recursive: true });
}

export function connectivityState(env = process.env) {
	try {
		if (fs.existsSync(STATE_FILE())) {
			return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
		}
	} catch {
		/* fall through */
	}
	return {
		status: "unknown",
		lastOnlineAt: null,
		lastOfflineAt: null,
		offlineSince: null,
		lastProbedAt: null,
		probeHistory: [],
	};
}

function tcpProbe(host, port, timeoutMs) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, timeoutMs);
		socket.once("connect", () => {
			clearTimeout(timer);
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			clearTimeout(timer);
			socket.destroy();
			resolve(false);
		});
	});
}

export async function probeConnectivity({ env = process.env, timeoutMs = 4000 } = {}) {
	const probes = DEFAULT_PROBES();
	const results = [];
	for (const probe of probes) {
		const ok = await tcpProbe(probe.host, probe.port, timeoutMs);
		results.push({ ...probe, ok });
	}
	const online = results.some((r) => r.ok);
	return { online, probedAt: new Date().toISOString(), results };
}

export async function updateConnectivityState({ env = process.env, timeoutMs = 4000 } = {}) {
	ensureDir();
	const previous = connectivityState(env);
	const probe = await probeConnectivity({ env, timeoutMs });
	const now = new Date().toISOString();
	const history = (previous.probeHistory || []).slice(-20);

	if (probe.online) {
		const transitioned = previous.status !== "online";
		const next = {
			online: true,
			status: "online",
			lastOnlineAt: transitioned ? now : previous.lastOnlineAt,
			lastOfflineAt: previous.lastOfflineAt,
			offlineSince: null,
			lastProbedAt: now,
			lastProbe: probe,
			recoveredAt: transitioned ? now : previous.recoveredAt,
			probeHistory: [...history, { at: now, status: "online" }],
		};
		fs.writeFileSync(STATE_FILE(), JSON.stringify(next, null, 2), "utf8");
		return next;
	}

	const transitioned = previous.status !== "offline";
	const next = {
		online: false,
		status: "offline",
		lastOnlineAt: previous.lastOnlineAt,
		lastOfflineAt: transitioned ? now : previous.lastOfflineAt,
		offlineSince: transitioned ? now : previous.offlineSince || now,
		lastProbedAt: now,
		lastProbe: probe,
		recoveredAt: previous.recoveredAt ?? null,
		probeHistory: [...history, { at: now, status: "offline" }],
	};
	fs.writeFileSync(STATE_FILE(), JSON.stringify(next, null, 2), "utf8");
	return next;
}

export function degradedMode(env = process.env) {
	const state = connectivityState(env);
	const forcedOffline = env.ESCALATION_FORCE_OFFLINE === "true";
	const degraded = forcedOffline || state.status === "offline" || state.status === "unknown";
	return {
		degraded,
		reason: forcedOffline ? "force_offline" : state.status,
		state,
	};
}

export function offlineForMs(env = process.env) {
	const state = connectivityState(env);
	if (!state.offlineSince) return 0;
	return Date.now() - new Date(state.offlineSince).getTime();
}

export default { probeConnectivity, updateConnectivityState, connectivityState, degradedMode, offlineForMs };
