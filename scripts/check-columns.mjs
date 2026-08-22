import pg from 'pg'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  const envFile = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    if (!process.env[t.slice(0,i).trim()]) process.env[t.slice(0,i).trim()] = t.slice(i+1).trim()
  }
} catch {}

const c = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='OwnerSettlement' ORDER BY ordinal_position")
console.log('OwnerSettlement columns:', r.rows.map(x=>x.column_name).join(', '))
const r2 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='OwnerAccount' ORDER BY ordinal_position")
console.log('OwnerAccount columns:', r2.rows.map(x=>x.column_name).join(', '))
await c.end()
