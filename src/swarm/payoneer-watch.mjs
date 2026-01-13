import fs from 'fs'
import path from 'path'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function listCsv(dir) {
  const d = path.resolve(dir)
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.csv')).map((f) => path.join(d, f))
}

function loadIndex(filePath) {
  try {
    const s = fs.readFileSync(filePath, 'utf8')
    const j = JSON.parse(s)
    return Array.isArray(j?.files) ? j.files : []
  } catch {
    return []
  }
}

function writeIndex(filePath, files) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify({ files }, null, 2))
}

export function checkNewBatches({ dir = 'settlements/payoneer', notifyDir = 'data/notifications' } = {}) {
  const idxPath = path.resolve(notifyDir, 'payoneer-index.json')
  const prev = loadIndex(idxPath)
  const cur = listCsv(dir)
  const prevSet = new Set(prev)
  const news = cur.filter((f) => !prevSet.has(f))
  const now = new Date().toISOString()
  if (news.length) {
    const outFile = path.resolve(notifyDir, `new-payoneer-batches_${Date.now()}.json`)
    ensureDir(path.dirname(outFile))
    fs.writeFileSync(outFile, JSON.stringify({ created_at: now, files: news }, null, 2))
    writeIndex(idxPath, cur)
    return { ok: true, count: news.length, file: outFile, files: news }
  }
  writeIndex(idxPath, cur)
  return { ok: true, count: 0, file: null, files: [] }
}

async function main() {
  const res = checkNewBatches({})
  process.stdout.write(`${JSON.stringify(res)}\n`)
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const selfPath = path.resolve(new URL(import.meta.url).pathname)
if (argvPath && selfPath === argvPath) {
  main().catch((e) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: String(e?.message || e) })}\n`)
    process.exitCode = 1
  })
}
