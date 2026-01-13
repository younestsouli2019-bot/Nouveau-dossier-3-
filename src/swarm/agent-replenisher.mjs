import { SwarmMemory } from './shared-memory.mjs'

export class AgentReplenisher {
  constructor({ memory = null, minActive = 5, templates = [] } = {}) {
    this.memory = memory || new SwarmMemory({ agents: [] })
    this.minActive = Number(minActive) || 5
    this.templates = Array.isArray(templates) && templates.length > 0
      ? templates
      : [
          { role: 'Content Amplifier Agent' },
          { role: 'Market Intelligence Scout' },
          { role: 'Course Promotion Coordinator' },
          { role: 'Community Builder' },
          { role: 'Analytics Monitor' }
        ]
  }

  list() {
    return Array.isArray(this.memory.get('agents')) ? this.memory.get('agents') : []
  }

  countActive() {
    const agents = this.list()
    return agents.filter(a => String(a.status || '') === 'active').length
  }

  spawnOne() {
    const tmpl = this.templates[Math.floor(Math.random() * this.templates.length)]
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const agent = {
      id,
      role: tmpl.role,
      status: 'active',
      created_at: new Date().toISOString(),
      last_heartbeat_at: null
    }
    const agents = this.list()
    agents.push(agent)
    this.memory.set('agents', agents)
    return agent
  }

  replenish() {
    const before = this.countActive()
    const toCreate = Math.max(0, this.minActive - before)
    const created = []
    for (let i = 0; i < toCreate; i++) {
      created.push(this.spawnOne())
    }
    return {
      ok: true,
      target: this.minActive,
      before,
      created_count: created.length,
      created
    }
  }
}
