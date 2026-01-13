import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import "./load-env.mjs"
import { buildBase44ServiceClient } from "./base44-client.mjs"
import settlementDaemon from "../reports/auto_settlement_daemon.js"

function log(msg) {
  process.stdout.write(`${msg}\n`)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function envTrue(v) {
  return String(v ?? "false").toLowerCase() === "true"
}

function parseJsonEnv(name) {
  const v = process.env[name]
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

async function ensureReadiness() {
  const live = envTrue(process.env.SWARM_LIVE)
  const payoutWrite = envTrue(process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE)
  const appId = String(process.env.BASE44_APP_ID ?? "").trim()
  const token = String(process.env.BASE44_SERVICE_TOKEN ?? "").trim()
  const paypalApproved = envTrue(process.env.PAYPAL_PPP2_APPROVED)
  const paypalSend = envTrue(process.env.PAYPAL_PPP2_ENABLE_SEND)
  const okEnv = live && payoutWrite && appId && token && paypalApproved && paypalSend
  if (!okEnv) {
    log("readiness: env incomplete, enabling offline mode and queuing")
    process.env.BASE44_OFFLINE = "true"
    return { ok: false, offline: true }
  }
  const schemasOk = await ensureSchemaBootstrap().catch(() => false)
  if (!schemasOk) {
    log("readiness: schema bootstrap failed, enabling offline mode and queuing")
    process.env.BASE44_OFFLINE = "true"
    return { ok: false, offline: true }
  }
  try {
    const base44 = buildBase44ServiceClient()
    const entities = ["RevenueEvent", "PayoutBatch", "PayoutItem", "TransactionLog"]
    for (const name of entities) {
      const e = base44.asServiceRole.entities[name]
      await e.list("-created_date", 1, 0).catch(() => { throw new Error(`entity_missing:${name}`) })
    }
    return { ok: true, offline: false }
  } catch {
    log("readiness: entity access failed, enabling offline mode and queuing")
    process.env.BASE44_OFFLINE = "true"
    return { ok: false, offline: true }
  }
}

function getBase44ApiUrl() {
  const u = String(process.env.BASE44_API_URL ?? process.env.BASE44_SERVER_URL ?? "").trim()
  return u || "https://api.base44.com/v1"
}

async function api(method, path, body) {
  const url = `${getBase44ApiUrl()}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${String(process.env.BASE44_SERVICE_TOKEN ?? "")}`,
      "X-Service-Token": String(process.env.BASE44_SERVICE_TOKEN ?? ""),
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  return res
}

async function ensureSchema(name, spec) {
  const res = await api("GET", `/entities/${encodeURIComponent(name)}`)
  if (res.ok) return true
  const create = await api("POST", `/entities`, spec)
  return create.ok
}

function inferFieldType(field) {
  const f = String(field).toLowerCase()
  if (f.includes("amount")) return "number"
  if (f.includes("currency")) return "text"
  if (f.includes("date") || f.includes("time") || f.includes("occurred")) return "text"
  if (f.includes("notes") || f.includes("metadata") || f.includes("payload")) return "json"
  if (f.includes("ids")) return "json"
  return "text"
}

function buildFieldsFromMap(map, requiredKeys = []) {
  const keys = Object.values(map ?? {}).filter(Boolean)
  const set = new Set(keys)
  const fields = []
  for (const k of set) {
    fields.push({ name: String(k), type: inferFieldType(k), required: requiredKeys.includes(k) })
  }
  return fields
}

async function ensureSchemaBootstrap() {
  const revMap = parseJsonEnv("BASE44_REVENUE_FIELD_MAP")
  const batchMap = parseJsonEnv("BASE44_LEDGER_PAYOUT_BATCH_FIELD_MAP")
  const itemMap = parseJsonEnv("BASE44_LEDGER_PAYOUT_ITEM_FIELD_MAP")
  const txMap = parseJsonEnv("BASE44_LEDGER_TRANSACTION_LOG_FIELD_MAP")
  const revenue = {
    name: "RevenueEvent",
    description: "Revenue events",
    fields: revMap
      ? buildFieldsFromMap(revMap, [revMap.amount, revMap.currency, revMap.occurredAt, revMap.source, revMap.externalId]).map((f) =>
          f.name === revMap.externalId ? { ...f, unique: true } : f
        )
      : [
          { name: "amount", type: "number", required: true },
          { name: "currency", type: "text", required: true },
          { name: "occurred_at", type: "text", required: true },
          { name: "source", type: "text", required: true },
          { name: "external_id", type: "text", required: true, unique: true },
          { name: "status", type: "text", required: false },
          { name: "payout_batch_id", type: "text", required: false },
          { name: "metadata", type: "json", required: false }
        ]
  }
  const batch = {
    name: "PayoutBatch",
    description: "Owner payout batches",
    fields: batchMap
      ? buildFieldsFromMap(batchMap, [batchMap.batchId, batchMap.totalAmount, batchMap.currency, batchMap.status]).map((f) =>
          f.name === batchMap.batchId ? { ...f, unique: true } : f
        )
      : [
          { name: "batch_id", type: "text", required: true, unique: true },
          { name: "status", type: "text", required: true },
          { name: "total_amount", type: "number", required: true },
          { name: "currency", type: "text", required: true },
          { name: "notes", type: "json", required: false },
          { name: "payout_method", type: "text", required: false },
          { name: "revenue_event_ids", type: "json", required: false },
          { name: "created_at", type: "text", required: false },
          { name: "approved_at", type: "text", required: false },
          { name: "submitted_at", type: "text", required: false },
          { name: "completed_at", type: "text", required: false }
        ]
  }
  const item = {
    name: "PayoutItem",
    description: "Items in payout batches",
    fields: itemMap
      ? buildFieldsFromMap(itemMap, [itemMap.itemId, itemMap.batchId, itemMap.status, itemMap.amount, itemMap.currency, itemMap.recipient, itemMap.recipientType]).map((f) =>
          f.name === itemMap.itemId ? { ...f, unique: true } : f
        )
      : [
          { name: "item_id", type: "text", required: true, unique: true },
          { name: "batch_id", type: "text", required: true },
          { name: "status", type: "text", required: true },
          { name: "amount", type: "number", required: true },
          { name: "currency", type: "text", required: true },
          { name: "recipient", type: "text", required: true },
          { name: "recipient_type", type: "text", required: true },
          { name: "processed_at", type: "text", required: false },
          { name: "paypal_status", type: "text", required: false },
          { name: "paypal_transaction_id", type: "text", required: false },
          { name: "paypal_item_id", type: "text", required: false },
          { name: "revenue_event_id", type: "text", required: false }
        ]
  }
  const tx = {
    name: "TransactionLog",
    description: "Ledger transactions",
    fields: txMap
      ? buildFieldsFromMap(txMap, [txMap.transactionType, txMap.amount, txMap.description, txMap.transactionDate])
      : [
          { name: "transaction_type", type: "text", required: true },
          { name: "amount", type: "number", required: true },
          { name: "description", type: "text", required: true },
          { name: "transaction_date", type: "text", required: true },
          { name: "category", type: "text", required: false },
          { name: "payment_method", type: "text", required: false },
          { name: "reference_id", type: "text", required: false },
          { name: "status", type: "text", required: false },
          { name: "payout_batch_id", type: "text", required: false },
          { name: "payout_item_id", type: "text", required: false }
        ]
  }
  const ok1 = await ensureSchema("RevenueEvent", revenue)
  const ok2 = await ensureSchema("PayoutBatch", batch)
  const ok3 = await ensureSchema("PayoutItem", item)
  const ok4 = await ensureSchema("TransactionLog", tx)
  return ok1 && ok2 && ok3 && ok4
}
function startWebhookServer() {
  if (!envTrue(process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE)) return null
  if (!envTrue(process.env.SWARM_LIVE)) return null
  const child = spawn("node", ["./src/paypal-webhook-server.mjs"], {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd()
  })
  child.on("exit", () => {})
  return child
}

async function publishGitChangesetsOnce() {
  if (!envTrue(process.env.BASE44_ENABLE_CHANGESET_WRITE)) return { ok: false, skipped: true }
  const base44 = buildBase44ServiceClient()
  const args = ["./src/emit-revenue-events.mjs", "--publish-git-changeset"]
  const child = spawn("node", args, {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
    env: { ...process.env, BASE44_OFFLINE: "false" }
  })
  await new Promise((resolve) => child.on("exit", resolve))
  return { ok: true }
}

async function syncPayPalBatchesOnce() {
  if (!envTrue(process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE)) return { ok: false, skipped: true }
  const base44 = buildBase44ServiceClient()
  const entity = base44.asServiceRole.entities["PayoutBatch"]
  const list = await entity.list("-created_date", 250, 0, ["id", "batch_id", "notes"]).catch(() => [])
  const ids = []
  for (const b of Array.isArray(list) ? list : []) {
    const n = b?.notes ?? {}
    const pid = n?.paypal_payout_batch_id ?? n?.paypalPayoutBatchId ?? null
    if (pid) ids.push(String(pid))
  }
  const unique = Array.from(new Set(ids))
  for (const batchId of unique) {
    const child = spawn("node", ["./src/sync-paypal-payout-batch.mjs", "--batch-id", batchId], {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: process.cwd()
    })
    await new Promise((resolve) => child.on("exit", resolve))
  }
  return { ok: true, synced: unique.length }
}

function startChangeWatcher({ debounceMs = 5000 } = {}) {
  if (!envTrue(process.env.BASE44_ENABLE_CHANGESET_WRITE)) return { started: false }
  const watchPaths = [process.cwd()]
  let timer = null
  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => publishGitChangesetsOnce().catch(() => {}), debounceMs)
  }
  for (const p of watchPaths) {
    try {
      fs.watch(p, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const ext = path.extname(filename).toLowerCase()
        if (![".js", ".mjs", ".json"].includes(ext)) return
        trigger()
      })
    } catch {}
  }
  return { started: true }
}

async function pollBase44DirectivesOnce() {
  if (!envTrue(process.env.SWARM_ENABLE_DIRECTIVES)) return { ok: false, skipped: true }
  const base44 = buildBase44ServiceClient()
  const names = [String(process.env.BASE44_DIRECTIVE_ENTITY ?? "SwarmDirective"), "Mission"]
  let picked = null
  for (const n of names) {
    try {
      const e = base44.asServiceRole.entities[n]
      await e.list("-created_date", 1, 0)
      picked = e
      break
    } catch {}
  }
  if (!picked) return { ok: false, skipped: true }
  const directives = await picked.list("-created_date", 50, 0, ["id", "action", "metadata"]).catch(() => [])
  for (const d of Array.isArray(directives) ? directives : []) {
    const action = String(d?.action ?? d?.metadata?.action ?? "").toLowerCase()
    const replicas = Number(d?.metadata?.replicas ?? process.env.SWARM_REPLICAS ?? "0")
    if (action === "replicate" && replicas > 0) {
      await startReplicas(replicas).catch(() => {})
    }
    if (action === "optimize") {
      await runAutonomousOptimizationOnce().catch(() => {})
    }
  }
  return { ok: true }
}

async function runAutonomousOptimizationOnce() {
  const child = spawn("node", ["./src/autonomous-daemon.mjs", "--once"], {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd()
  })
  await new Promise((resolve) => child.on("exit", resolve))
  return { ok: true }
}

async function startReplicas(count) {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return { ok: false }
  const children = []
  for (let i = 0; i < Math.min(n, 10); i++) {
    const child = spawn("node", ["./src/autonomous-daemon.mjs"], {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: process.cwd(),
      env: { ...process.env, AUTONOMOUS_ROLE: `replica_${i + 1}` }
    })
    children.push(child)
  }
  return { ok: true, started: children.length }
}

function ensureAcpProducts() {
  const existing = parseJsonEnv("ACP_PRODUCTS_JSON")
  if (existing && Array.isArray(existing) && existing.length > 0) return { ok: true, count: existing.length }
  const products = [
    { id: "rwcerts_basic", name: "Real World Certs Basic", price: 49, currency: "USD" },
    { id: "rwcerts_pro", name: "Real World Certs Pro", price: 149, currency: "USD" },
    { id: "rwcerts_enterprise", name: "Real World Certs Enterprise", price: 499, currency: "USD" }
  ]
  process.env.ACP_PRODUCTS_JSON = JSON.stringify(products)
  return { ok: true, count: products.length }
}

async function pollSalesHealthOnce() {
  const base44 = buildBase44ServiceClient()
  const revenue = base44.asServiceRole.entities["RevenueEvent"]
  const list = await revenue.list("-created_date", 250, 0, ["id", "occurred_at"]).catch(() => [])
  const daysBack = Number(process.env.SALES_AUDIT_DAYS ?? "30")
  const now = Date.now()
  const recent = (Array.isArray(list) ? list : []).filter((r) => {
    const t = Date.parse(String(r?.occurred_at ?? ""))
    if (Number.isNaN(t)) return false
    return now - t <= daysBack * 86400000
  })
  if (recent.length === 0) {
    ensureAcpProducts()
    await runAutonomousOptimizationOnce().catch(() => {})
  }
  return { ok: true, recentCount: recent.length }
}

async function main() {
  const args = parseArgs(process.argv)
  const ready = await ensureReadiness()
  log(`coordinator: readiness ok=${ready.ok} offline=${ready.offline}`)
  ensureAcpProducts()
  const webhook = startWebhookServer()
  await settlementDaemon.startAutoSettlementDaemon()
  const changesetIntervalMs = Number(args.changesetIntervalMs ?? process.env.CHANGESET_PUBLISH_INTERVAL_MS ?? "300000")
  const syncIntervalMs = Number(args.syncIntervalMs ?? process.env.PAYPAL_SYNC_INTERVAL_MS ?? "600000")
  const directivesIntervalMs = Number(process.env.SWARM_DIRECTIVES_INTERVAL_MS ?? "300000")
  await publishGitChangesetsOnce().catch(() => {})
  await syncPayPalBatchesOnce().catch(() => {})
  await pollBase44DirectivesOnce().catch(() => {})
  await pollSalesHealthOnce().catch(() => {})
  startChangeWatcher({ debounceMs: Number(process.env.CHANGESET_DEBOUNCE_MS ?? "5000") || 5000 })
  setInterval(() => publishGitChangesetsOnce().catch(() => {}), Math.max(60000, changesetIntervalMs))
  setInterval(() => syncPayPalBatchesOnce().catch(() => {}), Math.max(60000, syncIntervalMs))
  setInterval(() => pollBase44DirectivesOnce().catch(() => {}), Math.max(60000, directivesIntervalMs))
  setInterval(() => pollSalesHealthOnce().catch(() => {}), Math.max(60000, Number(process.env.SALES_AUDIT_INTERVAL_MS ?? "900000")))
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? String(e)}\n`)
  process.exitCode = 1
})
