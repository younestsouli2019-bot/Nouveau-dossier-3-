import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { SwarmMemory } from '../src/swarm/shared-memory.mjs'
import { AgentReplenisher } from '../src/swarm/agent-replenisher.mjs'

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

async function main() {
  const minActive = Number(process.env.SWARM_MIN_ACTIVE_AGENTS || 5)
  const { agents, path: filePath } = loadAgents()
  const memory = new SwarmMemory({ agents })
  const replenisher = new AgentReplenisher({ memory, minActive })
  const res = replenisher.replenish()
  saveAgents(filePath, memory.get('agents'))
  console.log(JSON.stringify({ ...res, filePath }, null, 2))
}

main()
