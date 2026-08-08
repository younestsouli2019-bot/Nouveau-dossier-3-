import net from "node:net";

const PORT = Number(process.env.MOCK_SMTP_PORT || 2525);
const messages = [];

const server = net.createServer((socket) => {
	let buffer = "";
	let stage = "greeting";
	let data = "";
	const send = (line) => socket.write(`${line}\r\n`);

	send("220 mock.local ESMTP ready");

	socket.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		while (buffer.includes("\r\n")) {
			const idx = buffer.indexOf("\r\n");
			const line = buffer.slice(0, idx).replace(/[\r\n]/g, "");
			buffer = buffer.slice(idx + 2);
			handle(line);
		}
	});

	function handle(line) {
		if (stage === "data") {
			if (line === ".") {
				stage = "done";
				messages.push(data);
				console.log(`CAPTURED_MESSAGE_START\n${data}CAPTURED_MESSAGE_END`);
				data = "";
				send("250 2.0.0 queued");
			} else {
				data += line + "\n";
			}
			return;
		}
		const cmd = line.split(" ")[0].toUpperCase();
		const lower = line.toLowerCase();
		if (cmd === "EHLO") {
			send("250-mock.local");
			send("250 AUTH PLAIN LOGIN");
		} else if (cmd === "STARTTLS") {
			send("454 TLS not available on mock");
		} else if (cmd === "AUTH") {
			if (line.toUpperCase().includes("LOGIN")) {
				stage = "auth_user";
				send("334 VXNlcm5hbWU6");
			} else {
				send("235 2.7.0 authentication successful");
			}
		} else if (stage === "auth_user") {
			stage = "auth_pass";
			send("334 UGFzc3dvcmQ6");
		} else if (stage === "auth_pass") {
			stage = "ready";
			send("235 2.7.0 authentication successful");
		} else if (cmd === "MAIL" && lower.startsWith("mail from")) {
			send("250 2.1.0 ok");
		} else if (cmd === "RCPT" && lower.startsWith("rcpt to")) {
			send("250 2.1.5 ok");
		} else if (cmd === "DATA") {
			stage = "data";
			send("354 end with <CRLF>.<CRLF>");
		} else if (cmd === "QUIT") {
			send("221 2.0.0 bye");
			socket.end();
		} else {
			send("250 ok");
		}
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`MOCK_SMTP listening on 127.0.0.1:${PORT}`);
});

server.on("connection", (s) => {
	console.log("connection");
	s.on("error", () => {});
});

process.on("SIGINT", () => {
	console.log(`\nCaptured ${messages.length} message(s):`);
	for (const m of messages) console.log(`---\n${m}`);
	server.close();
	process.exit(0);
});
