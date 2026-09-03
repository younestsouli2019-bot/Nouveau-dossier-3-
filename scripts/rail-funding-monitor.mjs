#!/usr/bin/env node
/**
 * rail-funding-monitor.mjs  (AUTONOMOUS · READ-ONLY · no money movement)
 *
 * The "green-light" signal for settlement. Consolidates the two hard facts the
 * integrity audits need before any owner settlement may proceed:
 *
 *   1. Is the supervised optimum outbound rail (Banking Circle) actually
 *      authenticated AND credentials working?  → via the read-only
 *      BankingCircleGateway.verify() (token + connectivity probe).
 *   2. Is the integrity gate clean?  → refuses proceed when INTEGRITY_GAP
 *      (proofHash=null PendingReasoning rows) or a funded/authorized flag is off.
 *
 * It NEVER sends anything. It emits a single honest boolean `deliverable` plus
 * the blockers that prevent funds movement. When the owner provisions the
 * Banking Circle send credential + a funded balance, this monitor is what flips
 * the supervised route to "deliverable" truthfully.
 *
 *   node scripts/rail-funding-monitor.mjs
 *
 * Env:
 *   SWARM_LIVE, BANKING_CIRCLE_ENABLE, BANKING_CIRCLE_CLIENT_ID/_SECRET,
 *   BANKING_CIRCLE_CERT/_KEY [optional --sandbox]; BANKING_CIRCLE_SANDBOX.
 *   OPTIONAL override: BANKING_CIRCLE_FUNDED="true" to mark balance available
 *   (otherwise deliverable stays false — we never assume funding).
 */
import "dotenv/config";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BankingCircleGateway } from "../src/financial/gateways/BankingCircleGateway.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data", "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const flag = (n) => String(process.env[n] ?? "").trim().toLowerCase() === "true";
const live = flag("SWARM_LIVE");
const bcEnabled = flag("BANKING_CIRCLE_ENABLE");
const bcFunded = flag("BANKING_CIRCLE_FUNDED");
const integrityClean = !existsSync(resolve(OUT, "postgres-integrity-audit.json"))
  ? null // not measured this session — treat as unknown (do not assume)
  : JSON.parse(readFileSync(resolve(OUT, "postgres-integrity-audit.json"), "utf8")).verdict !== "INTEGRITY_GAP";

const blockers = [];
let bc = null;
if (!live) blockers.push("SWARM_LIVE not true");
if (!bcEnabled) blockers.push("BANKING_CIRCLE_ENABLE not true (route off)");
else {
  try {
    const gw = new BankingCircleGateway({ sandbox: process.env.BANKING_CIRCLE_SANDBOX });
    bc = await gw.verify();
    if (!bc.ok) blockers.push(`Banking Circle connectivity not verified (probe=${JSON.stringify(bc.capabilityProbe?.probe)})`);
  } catch (e) {
    bc = { ok: false, error: e?.message || String(e) };
    blockers.push(`Banking Circle connect failed: ${bc.error}`);
  }
}
if (!bcFunded) blockers.push("BANKING_CIRCLE_FUNDED not set (cannot assume funds)");
if (integrityClean === null) blockers.push("integrity verdict not measured yet (run postgres-integrity-audit)");
else if (!integrityClean) blockers.push("INTEGRITY_GAP still present (unverified completed rows) — do not settle");

const deliverable = blockers.length === 0;

const report = {
  at: new Date().toISOString(),
  engine: "rail-funding-monitor",
  deliverable,
  supervisedRail: {
    name: "banking_circle_usd_no_fx",
    authenticated: Boolean(bc?.ok),
    funded: bcFunded,
  },
  integrityClean,
  blockers,
  note: "READ-ONLY. deliverable=true is the ONLY honest green-light for settlement. Money stays pending_manual until it is true.",
};

writeFileSync(resolve(OUT, "rail-funding-monitor.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ deliverable, authenticated: Boolean(bc?.ok), bcFunded, integrityClean, blockers }, null, 2));
process.exit(report.deliverable ? 0 : 1);