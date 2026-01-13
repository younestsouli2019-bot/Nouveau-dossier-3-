import fs from 'fs'
import path from 'path'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.qodo', 'archive'])
const IGNORE_FILES = new Set(['CREDS.txt'])

function walk(dir) {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue
      out.push(...walk(p))
    } else {
      if (IGNORE_FILES.has(e.name)) continue
      out.push(p)
    }
  }
  return out
}

function scanFile(file) {
  try {
    const s = fs.readFileSync(file, 'utf8')
    const findings = []
    const patterns = [
      { name: 'api_key_like', re: /\b[a-zA-Z0-9]{32,}\b/g },
      { name: 'secret_assign', re: /(secret|client_secret|api_secret)\s*[:=]\s*['"][^'"]{12,}['"]/gi },
      { name: 'key_assign', re: /(key|api_key|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi },
      { name: 'private_key', re: /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/ }
    ]
    for (const pat of patterns) {
      const m = s.match(pat.re)
      if (m && m.length) {
        findings.push({ pattern: pat.name, count: m.length })
      }
    }
    return findings
  } catch {
    return []
  }
}

function main() {
  const root = process.cwd()
  const files = walk(root)
  const report = []
  for (const f of files) {
    const findings = scanFile(f)
    if (findings.length) {
      report.push({ file: f, findings })
    }
  }
  const outDir = path.resolve('data/security')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `secrets-scan_${Date.now()}.json`)
  fs.writeFileSync(outFile, JSON.stringify({ created_at: new Date().toISOString(), items: report }, null, 2))
  console.log(JSON.stringify({ ok: true, file: outFile, total_files: files.length, findings_files: report.length }))
}

main()
