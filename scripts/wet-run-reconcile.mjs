import dotenv from "dotenv"
import { buildBase44ServiceClient } from "../src/base44-client.mjs"

dotenv.config({ path: ".env2" })
const c = buildBase44ServiceClient({ mode: "online" })
const E = c.asServiceRole.entities

async function fetchAll(entity, limit = 200) {
  const out = []
  let offset = 0
  for (;;) {
    const page = await withRetry(() => entity.list("-created_date", limit, offset, null), 4)
    out.push(...page)
    if (page.length < limit) break
    offset += limit
    await sleep(400)
  }
  return out
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry(fn, n) {
  for (let i = 0; i < n; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === n - 1) throw e
      await sleep(800 * (i + 1))
    }
  }
}

const revenue = await fetchAll(E.RevenueEvent).catch((e) => {
  console.error("revenue fetch failed:", e.message)
  return []
})
const batches = await fetchAll(E.PayoutBatch).catch((e) => {
  console.error("batch fetch failed:", e.message)
  return []
})
const items = await fetchAll(E.PayoutItem).catch((e) => {
  console.error("item fetch failed:", e.message)
  return []
})
const missions = await fetchAll(E.Mission).catch((e) => {
  console.error("mission fetch failed:", e.message)
  return []
})

const sum = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0)

const revenueBy = {}
for (const r of revenue) revenueBy[r.status] = (revenueBy[r.status] || 0) + 1
const batchBy = {}
for (const b of batches) batchBy[b.status] = (batchBy[b.status] || 0) + 1
const itemBy = {}
for (const i of items) itemBy[i.status] = (itemBy[i.status] || 0) + 1

const revSum = sum(revenue, (r) => r.amount)
const batchSum = sum(batches, (b) => b.total_amount)
const itemSum = sum(items, (i) => i.amount)

const itemsWithProof = items.filter(
  (i) => i.external_transaction_id || i.provider_transaction_id || i.paypal_batch_id || i.tx_hash,
)
const linked = batches.filter((b) => b.revenue_event_ids && b.revenue_event_ids.length)
const linkedIds = new Set()
for (const b of batches) for (const id of b.revenue_event_ids || []) linkedIds.add(id)
const revenueUsed = revenue.filter((r) => linkedIds.has(r.id))
const revenueUnused = revenue.filter((r) => !linkedIds.has(r.id))

const result = {
  generatedAt: new Date().toISOString(),
  scope: "Live wet-run reconciliation: api.base44.app app=689afeabf1db9c30efe0bd7e (dotenv=.env2)",
  counts: {
    revenueEvents: revenue.length,
    payoutBatches: batches.length,
    payoutItems: items.length,
    missions: missions.length,
  },
  byStatus: { revenueBy, batchBy, itemBy },
  totals: { revenueUSD: revSum, payoutBatchUSD: batchSum, payoutItemUSD: itemSum },
  linkage: {
    batchesLinkedToRevenue: linked.length,
    revenueEventsUsedByBatches: revenueUsed.length,
    revenueEventsUnused: revenueUnused.length,
    unusedSumUSD: sum(revenueUnused, (r) => r.amount),
    itemsWithExternalProof: itemsWithProof.length,
    itemsWithoutExternalProof: items.length - itemsWithProof.length,
  },
  balanceCheck: {
    revenueVsBatchDelta: +(revSum - batchSum).toFixed(2),
    revenueVsItemDelta: +(revSum - itemSum).toFixed(2),
  },
}
console.log(JSON.stringify(result, null, 2))