import fs from "node:fs";
import { verifyMandateEnvelope } from "./ap2-mandate.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function readJsonFromStdin() {
  const raw = fs.readFileSync(0, "utf8");
  return JSON.parse(raw);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv);
  const envelope = args.file ? readJsonFile(String(args.file)) : args.json ? JSON.parse(String(args.json)) : readJsonFromStdin();
  const out = verifyMandateEnvelope(envelope);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});

