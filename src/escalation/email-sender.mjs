import net from "node:net";
import tls from "node:tls";
import os from "node:os";

const DEFAULT_PORT = 587;

export function smtpConfig(env = process.env) {
	const host = env.SMTP_HOST || env.MAIL_HOST || "";
	const port = Number(env.SMTP_PORT || env.MAIL_PORT || DEFAULT_PORT);
	return {
		host: host || null,
		port: port || DEFAULT_PORT,
		secure: env.SMTP_SECURE === "true" || env.MAIL_SECURE === "true",
		user: env.SMTP_USER || env.MAIL_USER || env.SMTP_USERNAME || "",
		pass: env.SMTP_PASS || env.MAIL_PASS || env.SMTP_PASSWORD || "",
		from: env.SMTP_FROM || env.MAIL_FROM || "",
		requireTls: env.SMTP_REQUIRE_TLS !== "false",
		authMethod: env.SMTP_AUTH_METHOD || "auto",
	};
}

export function isSmtpConfigured(env = process.env) {
	const cfg = smtpConfig(env);
	return Boolean(cfg.host && cfg.user && cfg.pass);
}

export function missingSmtpHint(env = process.env) {
	const missing = [];
	if (!env.SMTP_HOST) missing.push("SMTP_HOST");
	if (!env.SMTP_USER) missing.push("SMTP_USER");
	if (!env.SMTP_PASS) missing.push("SMTP_PASS");
	return missing.length
		? `Live SMTP send unavailable - set ${missing.join(", ")} in env.`
		: "";
}

class SmtpError extends Error {
	constructor(message, stage, code) {
		super(message);
		this.name = "SmtpError";
		this.stage = stage;
		this.code = code;
	}
}

function osHostname() {
	return os.hostname().replace(/[^a-zA-Z0-9.-]/g, "") || "localhost";
}

function base64(str) {
	return Buffer.from(str, "utf8").toString("base64");
}

function parseResponse(raw) {
	const lines = raw.split("\r\n").filter(Boolean);
	const code = Number((lines[0] ?? "").slice(0, 3));
	const message = lines.join(" | ");
	return { code, message, lines };
}

export async function sendEmail({ to, cc = [], from, subject, body, env = process.env, timeoutMs = 20000 }) {
	const cfg = smtpConfig(env);
	if (!cfg.host) throw new SmtpError("SMTP_HOST not configured", "config");
	if (!cfg.user || !cfg.pass) throw new SmtpError("SMTP_USER/SMTP_PASS not configured", "config");

	const fromAddr = from || cfg.from || cfg.user;

	let socket = cfg.secure
		? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
		: net.connect({ host: cfg.host, port: cfg.port });

	let buffer = "";
	const waiters = [];
	socket.on("error", (err) => {
		while (waiters.length) {
			const waiter = waiters.shift();
			waiter.done("");
			waiter.reject(new SmtpError(`SMTP connection error: ${err.message}`, "connection", err.code));
		}
	});
	socket.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		while (true) {
			const idx = buffer.indexOf("\r\n");
			if (idx === -1) break;
			const line = buffer.slice(0, idx + 2);
			buffer = buffer.slice(idx + 2);
				const isLast = /^\d{3} /.test(line);
				const waiting = waiters[0];
				if (waiting) {
					waiting.lines.push(line);
					if (isLast) {
						const cb = waiters.shift();
						cb.done(waiting.lines.join(""));
					}
			}
		}
	});

	function awaitResponse() {
		return new Promise((resolve, reject) => {
			const waiter = { lines: [], done: resolve, reject };
			waiters.push(waiter);
			setTimeout(() => {
				const i = waiters.indexOf(waiter);
				if (i !== -1) waiters.splice(i, 1);
				reject(new SmtpError(`SMTP timeout waiting for response`, "timeout"));
			}, timeoutMs);
		});
	}

	function expect(code) {
		return new Promise((resolve, reject) => {
			awaitResponse().then((raw) => {
				const parsed = parseResponse(raw);
				if (Math.floor(parsed.code / 100) === Math.floor(code / 100)) {
					resolve(parsed);
				} else {
					reject(new SmtpError(`SMTP rejected (${parsed.code}): ${parsed.message}`, "response", parsed.code));
				}
			}).catch(reject);
		});
	}

	async function cmd(line, code) {
		socket.write(`${line}\r\n`);
		return expect(code);
	}

	try {
		await expect(220);

		await cmd(`EHLO ${osHostname()}`, 250);

		if (!cfg.secure && cfg.requireTls) {
			try {
				await cmd("STARTTLS", 220);
				const secure = await new Promise((resolve, reject) => {
					const upgraded = tls.connect({ socket, servername: cfg.host });
					upgraded.on("secureConnect", () => resolve(upgraded));
					upgraded.on("error", reject);
				});
				socket.destroy();
				socket = secure;
				buffer = "";
				secure.on("data", (chunk) => {
					buffer += chunk.toString("utf8");
					while (true) {
						const idx = buffer.indexOf("\r\n");
						if (idx === -1) break;
						const line = buffer.slice(0, idx + 2);
						buffer = buffer.slice(idx + 2);
						const isLast = /^\d{3} /.test(line);
						const waiting = waiters[0];
						if (waiting) {
							waiting.lines.push(line);
							if (isLast) {
								const cb = waiters.shift();
								cb.done(waiting.lines.join(""));
							}
						}
					}
				});
				await cmd(`EHLO ${osHostname()}`, 250);
			} catch (err) {
				if (err instanceof SmtpError && err.code === 5) throw err;
			}
		}

		const usePlain = cfg.authMethod === "plain";
		if (usePlain) {
			await cmd(`AUTH PLAIN ${base64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`, 235);
		} else {
			await cmd("AUTH LOGIN", 334);
			await cmd(base64(cfg.user), 334);
			await cmd(base64(cfg.pass), 235);
		}

		await cmd(`MAIL FROM:<${fromAddr}>`, 250);
		const ccList = typeof cc === "string" ? (cc ? [cc] : []) : Array.isArray(cc) ? cc : [];
		const recipients = [to, ...ccList].filter(Boolean);
		for (const rcpt of recipients) {
			await cmd(`RCPT TO:<${rcpt}>`, 250);
		}

		await cmd("DATA", 354);
		const date = new Date().toUTCString();
		const headers = [
			`Date: ${date}`,
			`From: ${fromAddr}`,
			`To: ${to}`,
			ccList.length ? `Cc: ${ccList.join(", ")}` : null,
			"Subject: " + String(subject ?? ""),
			"MIME-Version: 1.0",
			'Content-Type: text/plain; charset="utf-8"',
			"Content-Transfer-Encoding: 8bit",
			"",
			body,
		].filter(Boolean).join("\r\n");
		await cmd(`${headers}\r\n.\r\n`, 250);

		try {
			socket.write("QUIT\r\n");
		} catch {
			/* server may close first */
		}

		return {
			ok: true,
			channel: "email",
			mode: "live",
			host: cfg.host,
			port: cfg.port,
			secure: cfg.secure,
			to,
			cc,
			subject,
			from: fromAddr,
			sentAt: new Date().toISOString(),
		};
	} finally {
		if (socket && !socket.destroyed) {
			socket.destroy();
		}
	}
}

export default sendEmail;
