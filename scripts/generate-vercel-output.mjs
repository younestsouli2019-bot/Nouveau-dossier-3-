#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      copyDir(s, d)
    } else if (e.isFile()) {
      ensureDir(path.dirname(d))
      fs.copyFileSync(s, d)
    }
  }
}

function main() {
  const root = process.cwd()
  const outDir = path.join(root, '.vercel', 'output')
  const staticDir = path.join(outDir, 'static')
  const configPath = path.join(outDir, 'config.json')
  const distDir = path.join(root, 'dist')

  if (fs.existsSync(distDir)) {
    copyDir(distDir, staticDir)
  }

  if (!fs.existsSync(configPath)) {
    const config = {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        { src: '/api/(.*)', dest: '/api/index.ts' },
        { src: '/(.*)', dest: '/index.html' }
      ]
    }
    writeJson(configPath, config)
  }

  process.stdout.write(JSON.stringify({ ok: true, output: outDir }) + '\n')
}

if (process.argv[1] && process.argv[1].endsWith('generate-vercel-output.mjs')) {
  try {
    main()
    process.exit(0)
  } catch (e) {
    process.stderr.write(String(e?.message || e) + '\n')
    process.exit(1)
  }
}
