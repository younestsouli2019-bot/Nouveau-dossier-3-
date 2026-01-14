import fs from 'fs'
import path from 'path'
import { spawnSync } from 'node:child_process'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: process.cwd(), encoding: 'utf8' })
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' }
}

function summarizeBiome(output) {
  const sum = { errors: 0, warnings: 0, infos: 0, filesChecked: 0 }
  const mErr = output.match(/Found (\d+) errors/)
  const mWarn = output.match(/Found (\d+) warnings/)
  const mInfo = output.match(/Found (\d+) infos/)
  const mFiles = output.match(/Checked (\d+) files/)
  if (mErr) sum.errors = Number(mErr[1])
  if (mWarn) sum.warnings = Number(mWarn[1])
  if (mInfo) sum.infos = Number(mInfo[1])
  if (mFiles) sum.filesChecked = Number(mFiles[1])
  return sum
}

function summarizeEslint(output) {
  const sum = { fixed: false }
  sum.fixed = /--fix/.test(output) ? true : false
  return sum
}

function main() {
  const outDir = path.resolve('exports/reports')
  ensureDir(outDir)
  const ts = Date.now()
  const biome = run(process.env.npm_execpath || 'npm', ['run', 'lint'])
  const eslintFix = run(process.env.npm_execpath || 'npm', ['run', 'lint:fix'])
  const report = {
    created_at: new Date(ts).toISOString(),
    biome: { status: biome.status, summary: summarizeBiome((biome.stdout || '') + (biome.stderr || '')) },
    eslint_fix: { status: eslintFix.status, summary: summarizeEslint((eslintFix.stdout || '') + (eslintFix.stderr || '')) }
  }
  const file = path.join(outDir, `peer_review_${ts}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  process.stdout.write(`${file}\n`)
}

main()
