import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

export function loadAims(filePath = 'aim.HIGHER.txt') {
  const p = path.resolve(filePath)
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  return lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [title, metaRaw] = l.split('|').map((s) => s.trim())
      let meta = {}
      if (metaRaw) {
        try {
          meta = JSON.parse(metaRaw)
        } catch {
          meta = {}
        }
      }
      return { title, meta }
    })
}

function normEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function validateMission(m) {
  if (m.channel === 'paypal_order' && String(process.env.BUNKER_MODE || '').toLowerCase() === 'true') return false
  const rec = m.data?.recipient_email || m.data?.recipient || ''
  const pay = m.data?.payer_email || ''
  if (rec && pay && normEmail(rec) === normEmail(pay)) return false
  return true
}

export function aimsToMissions(aims) {
  const now = Date.now()
  return aims
    .map((a, i) => {
      const id = `aim_${now}_${i}`
      const channel = a.meta.channel || 'payoneer'
      const amounts = Array.isArray(a.meta.amounts) ? a.meta.amounts : []
      const recipient = a.meta.recipient || process.env.OWNER_PAYONEER_EMAIL || ''
      const mission = {
        id,
        title: a.title,
        channel,
        priority: a.meta.priority || 'medium',
        data: { ...a.meta, amounts, recipient },
        created_at: new Date().toISOString()
      }
      return mission
    })
    .filter((m) => validateMission(m))
}

export function writeMissions(missions, outDir = 'data/swarm/missions') {
  const dir = path.resolve(outDir)
  ensureDir(dir)
  const index = []
  for (const m of missions) {
    const f = path.join(dir, `${m.id}.json`)
    fs.writeFileSync(f, JSON.stringify(m, null, 2))
    index.push({ id: m.id, file: f })
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2))
  return index
}
