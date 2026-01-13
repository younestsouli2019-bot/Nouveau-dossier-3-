import fs from 'fs'
import path from 'path'
import https from 'https'

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    try {
      const req = https.get(url, (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          resolve(buf.toString('utf8'))
        })
      })
      req.on('error', (e) => reject(e))
      req.setTimeout(20000, () => {
        req.destroy(new Error('timeout'))
      })
    } catch (e) {
      reject(e)
    }
  })
}

function stripTags(html) {
  const s = String(html || '')
  return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
}

function pickTitle(html) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (t && t[1]) return String(t[1]).trim()
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1 && h1[1]) return String(h1[1]).trim()
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)
  if (h2 && h2[1]) return String(h2[1]).trim()
  return null
}

function classify(text) {
  const s = String(text || '').toLowerCase()
  const tags = []
  if (s.includes('cve-')) tags.push('security_vulnerability')
  if (s.includes('agentic')) tags.push('agentic_ai')
  if (s.includes('authentication')) tags.push('auth')
  if (s.includes('servicenow')) tags.push('servicenow')
  if (s.includes('paypal')) tags.push('paypal')
  if (s.includes('api')) tags.push('api_governance')
  return tags
}

export async function pollNews(sources = [], { outDir = 'data/swarm/news' } = {}) {
  const urls = Array.isArray(sources) ? sources : []
  if (!urls.length) return { ok: true, count: 0, file: null }
  ensureDir(outDir)
  const now = new Date().toISOString()
  const results = []
  for (const u of urls) {
    const ent = { url: u, ok: false, title: null, error: null, tags: [], parsed_at: now }
    try {
      const html = await fetchHtml(u)
      const title = pickTitle(html) || null
      const text = stripTags(html)
      const tags = classify(`${title || ''} ${text.slice(0, 500)}`)
      ent.ok = true
      ent.title = title
      ent.tags = tags
    } catch (e) {
      ent.ok = false
      ent.error = String(e?.message || e || 'unknown')
    }
    results.push(ent)
  }
  const file = path.join(outDir, `news_${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify({ created_at: now, entries: results }, null, 2))
  return { ok: true, count: results.length, file }
}
