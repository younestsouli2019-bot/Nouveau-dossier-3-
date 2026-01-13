import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'
import { SwarmMemory } from './shared-memory.mjs'
import { AgentReplenisher } from './agent-replenisher.mjs'
import { runRevenueSwarm } from '../revenue/swarm-runner.mjs'
import { calculatePosp, writePospProof } from '../consensus/posp.mjs'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function loadAgents() {
  const dir = path.resolve('data/swarm')
  const file = path.join(dir, 'agents.json')
  ensureDir(dir)
  if (!fs.existsSync(file)) return { agents: [] , path: file }
  try {
    const txt = fs.readFileSync(file, 'utf8')
    const json = JSON.parse(txt)
    const agents = Array.isArray(json?.agents) ? json.agents : []
    return { agents, path: file }
  } catch {
    return { agents: [] , path: file }
  }
}

function saveAgents(filePath, agents) {
  const out = { agents }
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2))
}

async function runCycle({ memory, replenisher, filePath }) {
  const rep = replenisher.replenish()
  saveAgents(filePath, memory.get('agents'))
  const rev = await runRevenueSwarm()
  const holder = process.env.SWARM_INSTANCE_ID || `local:${process.pid}`
  const posp = calculatePosp({ agentId: holder, windowDays: Number(process.env.POSP_WINDOW_DAYS ?? '30') || 30 })
  const proofPath = writePospProof(posp)
  const out = { ok: true, replenish: rep, revenue: rev, posp: { score: posp.score, proof: proofPath }, at: new Date().toISOString() }
  console.log(JSON.stringify(out))
  return out
}

export async function startSupervisor({ intervalMs, minActive } = {}) {
  const iv = Number(intervalMs ?? process.env.SWARM_SUPERVISOR_INTERVAL_MS ?? 60000) || 60000
  const min = Number(minActive ?? process.env.SWARM_MIN_ACTIVE_AGENTS ?? 5) || 5
  const { agents, path: filePath } = loadAgents()
  const memory = new SwarmMemory({ agents })
  const replenisher = new AgentReplenisher({ memory, minActive: min })
  await runCycle({ memory, replenisher, filePath })
  setInterval(() => {
    runCycle({ memory, replenisher, filePath }).catch(() => {})
  }, iv)
  return { ok: true, intervalMs: iv, minActive: min }
}

const selfPath = fileURLToPath(import.meta.url)
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const isMain = argvPath && path.resolve(selfPath) === argvPath

if (isMain) {
  startSupervisor().catch(() => {})
}
