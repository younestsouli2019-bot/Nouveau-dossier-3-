'use client'

import React, { useEffect, useState, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Play, RefreshCw, TrendingUp, PackageCheck, Eye, MousePointerClick,
  DollarSign, ShieldCheck, ExternalLink, Camera, FileVideo, Send, Gauge,
} from 'lucide-react'

interface StatusPayload {
  data_dir: string
  mode: 'live' | 'observe'
  config: { publish_allowed: boolean; catalog_url: string }
  summary: {
    trends: number
    campaigns: number
    published: number
    drafts: number
    views: number
    clicks: number
    sales: number
    earned: number
    ctr: number
  }
  critique: unknown
  recent_campaigns: Array<Record<string, unknown>>
  recent_clicks: Array<Record<string, unknown>>
  outbox: Array<{ name: string; status: string; campaign_id?: string; created_at?: string }>
}

const agentAgenda: Array<{ icon: React.ReactNode; name: string; blurb: string }> = [
  { icon: <TrendingUp className="w-4 h-4" />, name: 'Trend Scout', blurb: 'Scans RWC certification topics' },
  { icon: <Gauge className="w-4 h-4" />, name: 'Content Strategist', blurb: 'Quiz / cheat-sheet / career hooks' },
  { icon: <Camera className="w-4 h-4" />, name: 'Asset: Audio', blurb: 'ElevenLabs voiceover (dry-run)' },
  { icon: <FileVideo className="w-4 h-4" />, name: 'Asset: Visual', blurb: 'Flux/Replicate background' },
  { icon: <PackageCheck className="w-4 h-4" />, name: 'Video Assembly', blurb: 'Shotstack manifest + captions' },
  { icon: <Send className="w-4 h-4" />, name: 'Campaign Publisher', blurb: 'TikTok/YouTube outbox' },
  { icon: <Eye className="w-4 h-4" />, name: 'Performance Critic', blurb: 'CTR + attributed sales' },
]

function fmt(n: number | undefined): string {
  return Number(n || 0).toLocaleString()
}

function money(n: number | undefined): string {
  return `$${Number(n || 0).toFixed(2)}`
}

function shortTs(ts: string | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export default function RwcSocialPage() {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/rwc/status')
      if (!res.ok) throw new Error(`status ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const runEngine = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/rwc/run', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error || 'run failed')
      } else {
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      fetchStatus()
    }
  }

  const s = data?.summary
  const modeTone = data?.mode === 'live' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">RWC Social Swarm</h1>
              <p className="text-xs text-muted-foreground">YouTube · TikTok · RealWorldCerts — autonomous content pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={modeTone}>
              {data?.mode ?? '…'} mode
            </Badge>
            {data?.config.publish_allowed ? (
              <Badge variant="outline" className="font-mono bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                <ShieldCheck className="w-3 h-3 mr-1" /> publish allowed
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono bg-slate-500/10 text-slate-300 border-slate-500/30">
                publish dry-run
              </Badge>
            )}
            <Button variant="outline" size="sm" className="text-xs gap-1.5" disabled={loading} onClick={fetchStatus}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            <Button size="sm" className="text-xs gap-1.5" onClick={runEngine} disabled={running}>
              <Play className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} />
              {running ? 'Running…' : 'Run engine'}
            </Button>
            <Button variant="ghost" size="sm" className="text-xs gap-1.5" onClick={() => { window.location.href = '/' }}>
              Supply Chain
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Trends</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(s?.trends)}</p></CardContent></Card>
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Campaigns</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(s?.campaigns)}</p><p className="text-xs text-muted-foreground">{fmt(s?.drafts)} drafts · {fmt(s?.published)} published</p></CardContent></Card>
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Views</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(s?.views)}</p></CardContent></Card>
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Clicks</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(s?.clicks)}</p><p className="text-xs text-muted-foreground">CTR {((s?.ctr ?? 0) * 100).toFixed(2)}%</p></CardContent></Card>
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Sales</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(s?.sales)}</p></CardContent></Card>
          <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Attributed earned</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-emerald-600">{money(s?.earned)}</p></CardContent></Card>
        </div>

        <div className="grid lg:grid-cols-4 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Swarm agents</CardTitle><CardDescription>Blueprint pipeline</CardDescription></CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {agentAgenda.map((a) => (
                <div key={a.name} className="flex items-start gap-2.5 rounded-md border border-border/40 bg-background/30 px-3 py-2">
                  <span className="text-muted-foreground mt-0.5">{a.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{a.name}</div>
                    <div className="text-[10px] text-muted-foreground">{a.blurb}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="lg:col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent campaigns</CardTitle><CardDescription>Generated by the engine (latest first)</CardDescription></CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="max-h-80 slim-scroll">
                  <Table>
                    <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Domain</TableHead><TableHead>Angle</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(data?.recent_campaigns ?? []).length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No campaigns yet — hit “Run engine”.</TableCell></TableRow>
                      ) : (
                        data!.recent_campaigns.map((c: Record<string, unknown>, i) => (
                          <TableRow key={String(c.campaign_id || i)}>
                            <TableCell className="font-mono text-xs">{String(c.campaign_id)}</TableCell>
                            <TableCell className="text-xs">{String(c.domain || '—')}</TableCell>
                            <TableCell className="text-xs">{String(c.angle || '—')}</TableCell>
                            <TableCell><Badge variant="outline" className={c.published ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-slate-500/10 text-slate-300 border-slate-500/30'}>{c.published ? 'published' : 'draft'}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{shortTs(String(c.created_at))}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Publish outbox</CardTitle><CardDescription>Payloads ready for TikTok/YouTube (dry-run unless live)</CardDescription></CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="max-h-64 slim-scroll">
                  {(data?.outbox ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No outbox payloads yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data!.outbox.map((o) => (
                        <li key={o.name} className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/30 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-xs font-mono truncate">{o.name}</div>
                            <div className="text-[10px] text-muted-foreground">{o.campaign_id} · {shortTs(o.created_at)}</div>
                          </div>
                          <Badge variant="outline" className={o.status === 'published' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : o.status === 'failed' ? 'bg-red-500/10 text-red-300 border-red-500/30' : 'bg-slate-500/10 text-slate-300 border-slate-500/30'}>{o.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MousePointerClick className="w-4 h-4" /> Tracking feed</CardTitle><CardDescription>Events from /api/rwc/track?c=&lt;campaign&gt;&amp;evt=view|click|sale</CardDescription></CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="max-h-64 slim-scroll">
                  {(data?.recent_clicks ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No tracking events yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data!.recent_clicks.map((c: Record<string, unknown>, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/30 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-xs font-mono truncate">{String(c.campaign_id)}</div>
                            <div className="text-[10px] text-muted-foreground">{String(c.channel || '?')} · {shortTs(String(c.ts))}</div>
                          </div>
                          <Badge variant="outline" className={c.event === 'sale' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : c.event === 'click' ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' : 'bg-slate-500/10 text-slate-300 border-slate-500/30'}>{String(c.event)}{c.value_usd ? ` · $${Number(c.value_usd).toFixed(2)}` : ''}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <ExternalLink className="w-3 h-3" />
              Data dir: {data?.data_dir ?? '…'}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
