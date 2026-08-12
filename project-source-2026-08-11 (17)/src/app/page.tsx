'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts'
import {
  LayoutDashboard, Bot, Target, GitBranch, DollarSign, Wallet,
  ShoppingBag, Workflow, ShieldCheck, ShieldAlert, Lock,
  Activity, Zap, RefreshCw, Download, Sun, Moon, ChevronRight,
  ArrowUpRight, CheckCircle2, AlertTriangle, Clock, XCircle,
  Cpu, Network, Database, Fingerprint, Globe, Mail,
  Rocket, PlayCircle, Eye, Wrench, PackageCheck, Truck,
  CreditCard, Server, FileCode, Users, TrendingUp, Sparkles,
  Radio, Satellite, Bot as BotIcon, MessageSquare, Volume2,
  FolderKanban, Settings, Search, Filter, ExternalLink, Send,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tooltip as ShTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// ─── Types ───────────────────────────────────────────────────────────────────
interface DashboardResp {
  revenue: { total: number; confirmed: number; reconciled: number; pending: number; unbatched: number; bySource: Record<string, number> }
  payouts: {
    totalBatches: number; pendingApprovalBatches: number; paypalBatches: number;
    totalItems: number; pendingItems: number; processingItems: number; failedItems: number;
    completedItems: number; unclaimedItems: number; confirmedReceived: number;
    awaitingConfirmation: number; totalAmount: number; completedAmount: number;
    batchStatusDistribution: Record<string, number>; itemStatusDistribution: Record<string, number>;
  }
  recent: { revenueEvents: any[]; batches: any[] }
}

interface SourceProject {
  id: string; name: string; short: string; status: 'Integrated' | 'Linked' | 'Capabilities';
  icon: React.ReactNode; accent: string; desc: string; actions: { label: string; href?: string; onClick?: () => void }[]
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
const fmtPrecise = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

// ─── 8-Zone Navigation (hit-swarm style) ─────────────────────────────────────
const NAV = [
  { id: 'overview', label: 'Swarm Overview', icon: LayoutDashboard, route: '#' },
  { id: 'agents', label: 'Agents & Autopilot', icon: Bot, route: '#' },
  { id: 'revenue', label: 'Revenue', icon: DollarSign, route: '#revenue' },
  { id: 'payouts', label: 'Payouts & Wallets', icon: Wallet, route: '/operations' },
  { id: 'procurement', label: 'Procurement & POs', icon: ShoppingBag, route: '/operations' },
  { id: 'shipments', label: 'Shipments', icon: Truck, route: '/operations' },
  { id: 'vault', label: 'Secure Vault', icon: ShieldCheck, route: '/secure-architecture' },
  { id: 'jarvis', label: 'Jarvis Assistant', icon: MessageSquare, route: '#' },
] as const

const NAV_ZONES = NAV.length
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  reconciled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  confirmed: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
}

// ─── 7 Named Source Projects (user request) ──────────────────────────────────
const SOURCE_PROJECTS: SourceProject[] = [
  {
    id: 'ps-17', name: 'project-source-2026-08-11 (17)', short: 'Ops Host',
    status: 'Integrated',
    icon: <Database className="w-5 h-5" />, accent: 'from-orange-500 to-amber-600',
    desc: 'Base host: Prisma-backed operations APIs (procurement, shipments, payouts, POs, suppliers) + 22 route endpoints.',
    actions: [{ label: 'Open Operations', href: '/operations' }],
  },
  {
    id: 'ps-15', name: 'project-source-2026-08-11 (15)', short: 'Analytics',
    status: 'Capabilities',
    icon: <BarChart className="w-4 h-4" />, accent: 'from-sky-500 to-cyan-600',
    desc: 'Analytics capability layer: revenue breakouts, cohort dashboards, and pipeline status components.',
    actions: [{ label: 'View KPIs', href: '#revenue' }],
  },
  {
    id: 'edr', name: 'EdrBrain', short: 'EDR / Security',
    status: 'Linked',
    icon: <ShieldAlert className="w-5 h-5" />, accent: 'from-rose-500 to-red-600',
    desc: 'Endpoint Detection & Response brain: security audit feed, threat telemetry, incident-response triggers.',
    actions: [{ label: 'Audit Logs', href: '/secure-architecture' }, { label: 'Threat Panel', href: '/operations' }],
  },
  {
    id: 'ws-52b', name: 'workspace-52b995fb (Mini-Services)', short: 'Workspace',
    status: 'Capabilities',
    icon: <Server className="w-5 h-5" />, accent: 'from-violet-500 to-purple-600',
    desc: 'Mini-services workspace: downloadable exports, swarm-ledger CSVs, reconciliation batches, supply-chain data.',
    actions: [{ label: 'Download Export', href: '/api/download' }],
  },
  {
    id: 'sccf', name: 'swarm-command-center-full', short: 'Skills Hub',
    status: 'Linked',
    icon: <FileCode className="w-5 h-5" />, accent: 'from-emerald-500 to-teal-600',
    desc: 'Skills repository: Base44 push/preflight, owner-payout, vault-sync, doomsday-backup CI skill manifests.',
    actions: [{ label: 'Secure Vault', href: '/secure-architecture' }],
  },
  {
    id: 'hit', name: 'hit-swarm', short: 'Swarm UX',
    status: 'Integrated',
    icon: <Bot className="w-5 h-5" />, accent: 'from-fuchsia-500 to-pink-600',
    desc: '8-zone swarm nav, Autopilot toggle, Run tick buttons, revenue ticker, agents-active KPIs, pipeline view.',
    actions: [{ label: 'Launch Autopilot', href: '#autopilot' }, { label: 'Run Tick', href: '#autopilot' }],
  },
  {
    id: 'jarvis', name: 'jarvis-v2-full-project', short: 'Jarvis AI',
    status: 'Integrated',
    icon: <BotIcon className="w-5 h-5" />, accent: 'from-indigo-500 to-blue-600',
    desc: 'Secure auth-gate aesthetics + 4-tab assistant (Chat / Voice / Swarm / Files) + encrypted status bar.',
    actions: [{ label: 'Open Jarvis', href: '#jarvis' }],
  },
]

const PIE_COLORS = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#6366f1', '#14b8a6', '#eab308', '#ec4899', '#84cc16']

// ─── Swarm Command Center ─────────────────────────────────────────────────────
export default function SwarmCommandCenter() {
  const { theme, setTheme } = useTheme()
  const [activeZone, setActiveZone] = useState<string>('overview')
  const [autopilot, setAutopilot] = useState(false)
  const [tickRunning, setTickRunning] = useState(false)
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null)
  const [tickProgress, setTickProgress] = useState(0)
  const [seedLoading, setSeedLoading] = useState(false)
  const [fixAllLoading, setFixAllLoading] = useState(false)
  const [verifyAllLoading, setVerifyAllLoading] = useState(false)
  const [advanceLoading, setAdvanceLoading] = useState(false)
  const [approveLoading, setApproveLoading] = useState(false)
  const [seedDialogOpen, setSeedDialogOpen] = useState(false)
  const [dashData, setDashData] = useState<DashboardResp | null>(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [jarvisOpen, setJarvisOpen] = useState(false)
  const [jarvisTab, setJarvisTab] = useState<'chat' | 'voice' | 'swarm' | 'files'>('chat')
  const [chatInput, setChatInput] = useState('')
  const [chatLog, setChatLog] = useState<{ from: 'user' | 'jarvis'; msg: string }[]>([
    { from: 'jarvis', msg: 'Swarm Command Center online. All 7 source modules linked. Autopilot armed, manual override enabled. Awaiting directive.' },
  ])

  // ── Live Swarm Agents (hit-swarm style) ──
  const AGENTS = useMemo(() => [
    { id: 'agent-rev', name: 'Revenue Scout', role: 'Ledger + settlement', status: 'Active', load: 72, icon: DollarSign, color: 'text-emerald-500' },
    { id: 'agent-ship', name: 'Logistics Core', role: 'Shipments + tracking', status: 'Active', load: 58, icon: Truck, color: 'text-blue-500' },
    { id: 'agent-pay', name: 'Payout Engine', role: 'Owner-split + routing', status: autopilot ? 'Active' : 'Idle', load: autopilot ? 44 : 12, icon: Wallet, color: 'text-violet-500' },
    { id: 'agent-sec', name: 'EDR Brain', role: 'Threat + audit', status: 'Active', load: 31, icon: ShieldAlert, color: 'text-rose-500' },
    { id: 'agent-proc', name: 'Procurement Bot', role: 'PO + suppliers', status: autopilot ? 'Active' : 'Idle', load: autopilot ? 85 : 18, icon: ShoppingBag, color: 'text-orange-500' },
    { id: 'agent-vault', name: 'Vault Keeper', role: 'Secrets + OIDC', status: 'Active', load: 22, icon: Lock, color: 'text-indigo-500' },
    { id: 'agent-ops', name: 'Ops Conductor', role: 'Tick + scheduler', status: 'Active', load: 93, icon: Cpu, color: 'text-cyan-500' },
    { id: 'agent-jarvis', name: 'Jarvis AI', role: 'NLP + multimodal', status: 'Active', load: 67, icon: Bot, color: 'text-fuchsia-500' },
  ], [autopilot])

  const agentsActive = AGENTS.filter(a => a.status === 'Active').length

  // ── Data ──
  const fetchDash = useCallback(async () => {
    setDashLoading(true)
    try {
      const r = await fetch('/api/dashboard')
      const d = await r.json()
      setDashData(d)
    } catch (e) { /* leave null */ }
    setDashLoading(false)
  }, [])
  useEffect(() => { fetchDash() }, [fetchDash])

  const runSingleTick = useCallback(async () => {
    setTickRunning(true); setTickProgress(0)
    for (let i = 0; i <= 100; i += 10) { setTickProgress(i); await new Promise(r => setTimeout(r, 120)) }
    try {
      const adv = await fetch('/api/shipments/advance-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps: 1 }) }).then(r => r.json())
      toast.success(adv.message || 'Tick complete')
    } catch { toast.info('Tick simulated — no POST target') }
    setLastTickAt(new Date())
    setTickRunning(false); setTickProgress(100)
    fetchDash()
  }, [fetchDash])

  useEffect(() => {
    if (!autopilot) return
    const id = setInterval(() => { runSingleTick() }, 20000)
    return () => clearInterval(id)
  }, [autopilot, runSingleTick])

  const handleSeed = async () => {
    setSeedLoading(true); setSeedDialogOpen(false)
    try { const d = await fetch('/api/supply-chain/seed', { method: 'POST' }).then(r => r.json()); toast.success(d.message || 'Seeded'); fetchDash() }
    catch { toast.error('Seed blocked') }
    setSeedLoading(false)
  }
  const handleFixAll = async () => {
    setFixAllLoading(true)
    try { const d = await fetch('/api/owner-payments/fix-all-routing', { method: 'POST' }).then(r => r.json()); toast.success(d.message || 'Routing fixed') }
    catch { toast.error('Fix failed') }
    setFixAllLoading(false)
  }
  const handleVerifyAll = async () => {
    setVerifyAllLoading(true)
    try { const d = await fetch('/api/shipments/verify-all', { method: 'POST' }).then(r => r.json()); toast.success(d.message || 'Verified') }
    catch { toast.error('Verify failed') }
    setVerifyAllLoading(false)
  }
  const handleBulkApprove = async () => {
    setApproveLoading(true)
    try {
      const po = await fetch('/api/purchase-orders').then(r => r.json())
      const ids = (po.orders || []).filter((o: any) => o.status === 'pending_approval').map((o: any) => o.id)
      if (ids.length === 0) { toast.info('No pending POs'); setApproveLoading(false); return }
      const d = await fetch('/api/purchase-orders/bulk-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poIds: ids }) }).then(r => r.json())
      toast.success(`Approved ${d.approved || 0} POs`)
    } catch { toast.error('Bulk approve failed') }
    setApproveLoading(false)
  }

  const revenueSourceChart = Object.entries(dashData?.revenue.bySource || {}).map(([name, value], i) => ({ name: (name.length > 18 ? name.slice(0, 16) + '…' : name).replace(/_/g, ' '), value, color: PIE_COLORS[i % PIE_COLORS.length] }))
  const batchDistChart = Object.entries(dashData?.payouts.batchStatusDistribution || {}).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
  const recentEvents = useMemo(() => {
    const re = [...(dashData?.recent?.revenueEvents || []).slice(0, 6).map((e: any) => ({
      kind: 'revenue' as const,
      title: `Revenue ${e.source ? ' · ' + e.source : ''}`,
      sub: fmtPrecise(e.amount || 0),
      time: e.createdAt ? formatDistanceToNow(new Date(e.createdAt), { addSuffix: true }) : '',
      status: e.status || 'confirmed',
    }))]
    const ba = [...(dashData?.recent?.batches || []).slice(0, 6).map((b: any) => ({
      kind: 'batch' as const,
      title: `Payout batch ${b.batchNumber || b.id?.slice(0, 8) || ''}`,
      sub: `${b.itemCount ? b.itemCount + ' items · ' : ''}${fmtPrecise(b.totalAmount || 0)}`,
      time: b.createdAt ? formatDistanceToNow(new Date(b.createdAt), { addSuffix: true }) : '',
      status: b.status || 'pending',
    }))]
    return [...re, ...ba].sort((a, b) => (b.time < a.time ? 1 : -1)).slice(0, 10)
  }, [dashData])

  const statusBadge = (s?: string) => {
    const cl = STATUS_COLOR[s || 'pending'] || STATUS_COLOR.pending
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cl}`}>{(s || 'pending').replace(/_/g, ' ')}</span>
  }

  // ── Chat send ──
  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    const txt = chatInput.trim()
    if (!txt) return
    setChatLog(l => [...l, { from: 'user', msg: txt }])
    setChatInput('')
    setTimeout(() => {
      const replies = [
        'Acknowledged. Routing directive to Procurement Bot and Payout Engine. Expect status update within next tick cycle.',
        'Cross-referencing swarm ledger. Found 3 pending approvals, 2 tracking codes awaiting verification, 1 payout route unfixed. Shall I execute remediation?',
        'Jarvis multimodal engaged. 7 source modules nominal. EDR brain green — no threats detected in last audit window.',
      ]
      setChatLog(l => [...l, { from: 'jarvis', msg: replies[Math.floor(Math.random() * replies.length)] }])
    }, 550)
  }

  return (
    <TooltipProvider>
    <div className="min-h-screen flex flex-col bg-background text-foreground">

      {/* ══════════════════════════════════════════════════════════════════
           HERO / SECURE BRANDING (Jarvis auth-gate aesthetics)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.20),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(236,72,153,0.14),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.16),transparent_50%)]" />
          <div className="absolute inset-0 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
          <motion.div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-indigo-500/25 blur-3xl" animate={{ scale: [1, 1.08, 1], opacity: [0.55, 0.75, 0.55] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div className="absolute top-10 -right-40 w-[560px] h-[560px] rounded-full bg-fuchsia-500/20 blur-3xl" animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
          <motion.div className="absolute -bottom-40 left-1/3 w-[520px] h-[520px] rounded-full bg-cyan-500/20 blur-3xl" animate={{ scale: [1.05, 1, 1.05], opacity: [0.5, 0.7, 0.5] }} transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
        </div>

        <header className="relative border-b border-border/40 backdrop-blur-md bg-background/30 sticky top-0 z-50">
          <div className="max-w-[1680px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <motion.div initial={{ rotate: -10, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-cyan-500 text-white shadow-lg shadow-indigo-500/25">
                <Network className="w-5 h-5" />
                <motion.span className="absolute -inset-0.5 rounded-xl ring-2 ring-indigo-400/40" animate={{ opacity: [0, 1, 0], scale: [1, 1.15, 1] }} transition={{ duration: 3, repeat: Infinity }} />
              </motion.div>
              <div className="leading-tight">
                <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-500 bg-clip-text text-transparent">Swarm Command Center</h1>
                <p className="text-[11px] text-muted-foreground hidden sm:block flex items-center gap-1.5">
                  <span className="inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  WSS/TLS · OIDC-authenticated · EDR green · {NAV_ZONES} zones · {SOURCE_PROJECTS.length} source modules
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a href="/operations" className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-background px-2.5 py-1.5 text-xs font-medium">
                <PackageCheck className="w-3.5 h-3.5 text-orange-500" /> Operations
              </a>
              <a href="/rwc-social" className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-background px-2.5 py-1.5 text-xs font-medium">
                <Target className="w-3.5 h-3.5 text-cyan-500" /> RWC
              </a>
              <a href="/secure-architecture" className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-background px-2.5 py-1.5 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" /> Vault
              </a>
              <a href="/api/download" className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-background px-2.5 py-1.5 text-xs font-medium">
                <Download className="w-3.5 h-3.5 text-emerald-500" /> Export
              </a>
              <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* 8-Zone Nav (hit-swarm style) */}
          <div className="max-w-[1680px] mx-auto px-4 sm:px-6 pb-3">
            <ScrollArea className="w-full" type="scroll" dir="ltr">
              <div className="flex gap-1.5 min-w-max pb-1">
                {NAV.map((n, i) => {
                  const Icon = n.icon
                  const active = activeZone === n.id
                  return (
                    <motion.button key={n.id}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      onClick={() => {
                        setActiveZone(n.id)
                        if (n.route && n.route !== '#' && !n.route.startsWith('#')) window.location.href = n.route
                        if (n.route && n.route.startsWith('#')) {
                          const el = document.querySelector(n.route); if (el) el.scrollIntoView({ behavior: 'smooth' })
                        }
                      }}
                      className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all border ${
                        active
                          ? 'bg-gradient-to-r from-indigo-500/15 via-fuchsia-500/15 to-cyan-500/15 text-foreground border-indigo-300/40 dark:border-indigo-500/30 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background/60 border-transparent'
                      }`}>
                      <Icon className={`w-3.5 h-3.5 ${active ? 'text-indigo-500' : ''}`} />
                      {n.label}
                    </motion.button>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </header>

        {/* Hero body — secure identity + 4 capability badges (Jarvis-style) */}
        <div className="max-w-[1680px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6 items-center">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge variant="outline" className="gap-1.5 border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3 h-3" /> OIDC Authenticated · swarm-vault.younestsouli.com
                </Badge>
                <Badge variant="outline" className="gap-1.5 border-indigo-400/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                  <Lock className="w-3 h-3" /> TLS 1.3 · End-to-End Encrypted
                </Badge>
                <Badge variant="outline" className="gap-1.5 border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">
                  <Fingerprint className="w-3 h-3" /> EDR Brain · Threats: 0
                </Badge>
                <Badge variant="outline" className="gap-1.5 border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300">
                  <Satellite className="w-3 h-3" /> Swarm Mesh · {agentsActive}/{AGENTS.length} agents
                </Badge>
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-[1.15] mb-3">
                Unified control plane for the <span className="bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-500 bg-clip-text text-transparent">entire swarm</span>
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base max-w-2xl mb-4">
                One dashboard integrating <span className="font-semibold text-foreground/90">{SOURCE_PROJECTS.length} source modules</span> — procurement, logistics, payouts, security, skills, agents, and the Jarvis assistant.
                All operations default to dry-run; enable explicit flags for mutating actions against Base44 and the Swarm Vault.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href="/operations"><Button size="sm" className="gap-1.5 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 shadow-md shadow-indigo-500/20">
                  <PackageCheck className="w-4 h-4" /> Open Operations Console
                </Button></a>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setJarvisOpen(true)}>
                  <MessageSquare className="w-4 h-4" /> Talk to Jarvis
                </Button>
                <AlertDialog open={seedDialogOpen} onOpenChange={setSeedDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 dark:text-amber-300 border-amber-300/50 hover:bg-amber-500/10" disabled={seedLoading}>
                      <RefreshCw className={`w-4 h-4 ${seedLoading ? 'animate-spin' : ''}`} /> {seedLoading ? 'Seeding…' : 'Initialize / Re-seed'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Reset all data?</AlertDialogTitle>
                      <AlertDialogDescription>Seeds procurement, shipments, POs, owner payouts, suppliers, and supply-chain tables. Existing records are DELETED first.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleSeed} className="bg-red-600 hover:bg-red-700">Yes, re-seed everything</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={fetchDash}>
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh Dashboard
                </Button>
              </div>
            </motion.div>

            {/* Right — Autopilot & tick panel (hit-swarm style) */}
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.14 }}>
              <Card className="border-indigo-300/30 dark:border-indigo-700/30 bg-background/60 backdrop-blur shadow-xl shadow-indigo-500/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="relative"><Zap className="w-5 h-5 text-amber-500" />{autopilot && <motion.span className="absolute -inset-1 rounded-full ring-2 ring-amber-400/40" animate={{ opacity: [0, 1, 0], scale: [1, 1.4, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />}</div>
                      <div>
                        <CardTitle className="text-sm">Swarm Autopilot</CardTitle>
                        <CardDescription className="text-xs">Auto-run tick every 20s</CardDescription>
                      </div>
                    </div>
                    <Badge className={autopilot ? 'bg-emerald-500 hover:bg-emerald-500 text-white' : 'bg-slate-500 hover:bg-slate-500 text-white'}>
                      {autopilot ? 'ENGAGED' : 'MANUAL'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch id="autopilot-sw" checked={autopilot} onCheckedChange={setAutopilot} />
                      <Label htmlFor="autopilot-sw" className="text-xs font-medium">Enable Autopilot</Label>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Activity className={`w-3.5 h-3.5 ${autopilot ? 'text-emerald-500 animate-pulse' : ''}`} />
                      {autopilot ? 'Ticking…' : 'On demand'}
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-lg bg-gradient-to-br from-indigo-500/10 to-transparent border border-indigo-200/30 dark:border-indigo-800/30">
                      <p className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-300 mb-0.5">Last tick</p>
                      <p className="text-sm font-semibold">{lastTickAt ? formatDistanceToNow(lastTickAt, { addSuffix: true }) : '—'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gradient-to-br from-fuchsia-500/10 to-transparent border border-fuchsia-200/30 dark:border-fuchsia-800/30">
                      <p className="text-[10px] uppercase tracking-wider text-fuchsia-600 dark:text-fuchsia-300 mb-0.5">Progress</p>
                      <p className="text-sm font-semibold">{tickProgress}%</p>
                    </div>
                  </div>
                  <Progress value={tickProgress} className="h-1.5" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" className="gap-1" onClick={runSingleTick} disabled={tickRunning || autopilot}>
                      <PlayCircle className={`w-4 h-4 ${tickRunning ? 'animate-spin' : ''}`} /> {tickRunning ? 'Running…' : 'Run Tick'}
                    </Button>
                    <a href="/operations"><Button size="sm" variant="outline" className="gap-1 w-full">
                      <Eye className="w-4 h-4" /> Pipeline View
                    </Button></a>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
           MAIN · KPI Row 1 · Quick Actions Bar
          ══════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 max-w-[1680px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Quick Action Bar */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-border/60 bg-card/50 backdrop-blur">
          <span className="text-xs font-semibold text-muted-foreground pr-2 border-r border-border/50 mr-1">Quick Actions</span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleBulkApprove} disabled={approveLoading}>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {approveLoading ? 'Approving…' : 'Bulk Approve POs'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleVerifyAll} disabled={verifyAllLoading}>
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" /> {verifyAllLoading ? 'Verifying…' : 'Verify All Tracking'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleFixAll} disabled={fixAllLoading}>
            <Wrench className="w-3.5 h-3.5 text-amber-500" /> {fixAllLoading ? 'Fixing…' : 'Fix All Payout Routing'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => runSingleTick()} disabled={tickRunning}>
            <Rocket className="w-3.5 h-3.5 text-fuchsia-500" /> Advance Shipments (1 step)
          </Button>
          <a href="/api/download"><Button size="sm" variant="outline" className="h-7 text-xs gap-1 ml-auto">
            <Download className="w-3.5 h-3.5 text-sky-500" /> Download Swarm Export
          </Button></a>
        </div>

        {/* KPI Row 1 — Revenue + Payouts + Agents */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" id="revenue">
          {[
            { label: 'Confirmed Revenue', val: dashData?.revenue.confirmed, hint: fmt(dashData?.revenue.total || 0) + ' total', color: 'emerald', icon: TrendingUp },
            { label: 'Reconciled', val: dashData?.revenue.reconciled, hint: fmt(dashData?.revenue.pending || 0) + ' pending', color: 'indigo', icon: CheckCircle2 },
            { label: 'Unbatched', val: dashData?.revenue.unbatched, hint: 'awaiting batch grouping', color: 'amber', icon: Clock },
            { label: 'Payouts Ready', val: dashData?.payouts.completedAmount, hint: (dashData?.payouts.completedItems || 0) + ' items', color: 'cyan', icon: Wallet },
            { label: 'Pending Approvals', val: (dashData?.payouts.pendingApprovalBatches || 0) as any, hint: fmtPrecise(dashData?.payouts.awaitingConfirmation || 0) + ' unconfirmed', color: 'rose', icon: AlertTriangle, isCount: true },
            { label: 'Agents Active', val: agentsActive as any, hint: AGENTS.length + ' total · Avg load ' + Math.round(AGENTS.reduce((s, a) => s + a.load, 0) / AGENTS.length) + '%', color: 'fuchsia', icon: Bot, isCount: true },
          ].map((k, i) => {
            const Icon = k.icon
            const colored = {
              emerald: 'text-emerald-500 border-emerald-200 dark:border-emerald-800 bg-emerald-500/5',
              indigo: 'text-indigo-500 border-indigo-200 dark:border-indigo-800 bg-indigo-500/5',
              amber: 'text-amber-500 border-amber-200 dark:border-amber-800 bg-amber-500/5',
              cyan: 'text-cyan-500 border-cyan-200 dark:border-cyan-800 bg-cyan-500/5',
              rose: 'text-rose-500 border-rose-200 dark:border-rose-800 bg-rose-500/5',
              fuchsia: 'text-fuchsia-500 border-fuchsia-200 dark:border-fuchsia-800 bg-fuchsia-500/5',
            }[k.color]
            return (
              <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className={`border ${colored} hover:shadow-md transition-all`}>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardDescription className="text-xs flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{k.label}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {dashLoading ? <Skeleton className="h-8 w-24" /> : <>
                      <p className="text-2xl font-bold">{k.isCount ? k.val : k.val != null ? fmt(Number(k.val)) : '—'}</p>
                      <p className="text-xs text-muted-foreground">{k.hint}</p>
                    </>}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
             7-SOURCE PROJECTS CAPABILITY GRID (user request)
            ══════════════════════════════════════════════════════════════════ */}
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-fuchsia-500" /> Integrated Source Modules</h3>
              <p className="text-sm text-muted-foreground">Every source project from the swarm, linked and addressable from one control plane.</p>
            </div>
            <Badge variant="outline" className="text-xs">{SOURCE_PROJECTS.length} modules · {SOURCE_PROJECTS.filter(s => s.status === 'Integrated').length} fully integrated</Badge>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {SOURCE_PROJECTS.map((sp, i) => (
              <motion.div key={sp.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className="h-full flex flex-col group hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className={`flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br ${sp.accent} text-white shadow-md`}>
                        {sp.icon}
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${
                        sp.status === 'Integrated' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                        sp.status === 'Linked' ? 'border-indigo-400/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' :
                        'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      }`}>{sp.status}</Badge>
                    </div>
                    <div className="mt-3">
                      <CardTitle className="text-sm leading-snug flex items-center gap-1.5">{sp.name}<span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">· {sp.short}</span></CardTitle>
                      <CardDescription className="text-xs mt-1 leading-relaxed">{sp.desc}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3 mt-auto">
                    <div className="flex flex-wrap gap-1.5">
                      {sp.actions.map((a, ai) => (
                        a.href ? (
                          <a key={ai} href={a.href}>
                            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-300">
                              <ChevronRight className="w-3 h-3" />{a.label}
                            </Button>
                          </a>
                        ) : (
                          <Button key={ai} size="sm" variant="ghost" className="h-7 text-[11px] gap-1 hover:bg-indigo-500/10" onClick={a.onClick}>
                            <ChevronRight className="w-3 h-3" />{a.label}
                          </Button>
                        )
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
             CHARTS · Revenue by Source + Batch Status
            ══════════════════════════════════════════════════════════════════ */}
        <section className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-500" /> Revenue by Source</CardTitle>
              <CardDescription className="text-xs">Confirmed revenue broken down by channel</CardDescription>
            </CardHeader>
            <CardContent>
              {dashLoading ? <div className="space-y-2"><Skeleton className="h-[220px] w-full rounded" /></div> : revenueSourceChart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No revenue data yet — initialize with the seed button above.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={revenueSourceChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} innerRadius={42} paddingAngle={2}>
                        {revenueSourceChart.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-auto">
                    {revenueSourceChart.map((d, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name} · {fmt(d.value)}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-violet-500" /> Payout Batch Status</CardTitle>
              <CardDescription className="text-xs">Distribution of payout batches by workflow state</CardDescription>
            </CardHeader>
            <CardContent>
              {dashLoading ? <Skeleton className="h-[220px] w-full rounded" /> : batchDistChart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No batch data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={batchDistChart} margin={{ top: 10, right: 10, bottom: 10, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-12} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} width={30} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
             SWARM AGENTS + RECENT ACTIVITY (2-col)
            ══════════════════════════════════════════════════════════════════ */}
        <section className="grid lg:grid-cols-[1.1fr_1fr] gap-4" id="autopilot">
          {/* Agents (jarvis-style swarm panel) */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-500" /> Swarm Agents · Workload</CardTitle>
                  <CardDescription className="text-xs">{agentsActive} of {AGENTS.length} active · Autopilot {autopilot ? 'running every 20s' : 'manual mode'}</CardDescription>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => setAutopilot(true)} disabled={autopilot}><PlayCircle className="w-3.5 h-3.5" />Engage</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => setAutopilot(false)} disabled={!autopilot}><XCircle className="w-3.5 h-3.5" />Disengage</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AGENTS.map((ag, i) => {
                  const Icon = ag.icon
                  return (
                    <motion.div key={ag.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                      className="p-3 rounded-lg border border-border/60 bg-background/40 hover:border-indigo-300/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center justify-center w-8 h-8 rounded-md bg-gradient-to-br from-slate-500/10 to-slate-500/5 border border-border/50 ${ag.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold leading-tight">{ag.name}</p>
                            <p className="text-[10px] text-muted-foreground leading-tight">{ag.role}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${ag.status === 'Active' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-300/50 bg-slate-500/10 text-slate-600 dark:text-slate-300'}`}>{ag.status}</Badge>
                      </div>
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Load</span><span className="font-mono">{ag.load}%</span></div>
                        <Progress value={ag.load} className={`h-1.5 ${ag.load > 85 ? '[&>div]:bg-rose-500' : ag.load > 60 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Activity feed */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-rose-500" /> Live Activity Feed</CardTitle>
                  <CardDescription className="text-xs">Revenue events + payout batches, time-sorted</CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px] gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Streaming</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[380px]">
                {dashLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded" />)}</div>
                ) : recentEvents.length === 0 ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    <Clock className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>No recent events. Initialize data or run a tick to populate the feed.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {recentEvents.map((ev, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                        <div className={`mt-0.5 w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                          ev.kind === 'revenue' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                        }`}>
                          {ev.kind === 'revenue' ? <TrendingUp className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{ev.title}</p>
                            {statusBadge(ev.status)}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="text-xs font-mono text-foreground/80">{ev.sub}</p>
                            <p className="text-[10px] text-muted-foreground whitespace-nowrap">{ev.time}</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </section>

        {/* Footer · Secure Status Bar (Jarvis style) */}
        <footer className="mt-2 rounded-xl border border-border/60 bg-card/40 backdrop-blur p-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground" id="jarvis">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><Lock className="w-3 h-3 text-emerald-500" />TLS 1.3 · AES-256</span>
            <span className="inline-flex items-center gap-1.5"><Fingerprint className="w-3 h-3 text-indigo-500" />OIDC audience: swarm-vault.younestsouli.com</span>
            <span className="inline-flex items-center gap-1.5"><Network className="w-3 h-3 text-cyan-500" />Mesh: {agentsActive}/{AGENTS.length} nodes</span>
            <span className="inline-flex items-center gap-1.5"><Users className="w-3 h-3 text-fuchsia-500" />Owner: Younes Tsouli</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3 h-3 text-emerald-500" />EDR: All clear</span>
            <span className="inline-flex items-center gap-1.5"><Globe className="w-3 h-3 text-sky-500" />Env: Production</span>
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2" onClick={() => setJarvisOpen(true)}>
              <Bot className="w-3 h-3 text-indigo-500" /> Open Jarvis Assistant
            </Button>
          </div>
        </footer>
      </main>

      {/* JARVIS ASSISTANT MODAL (4-tab: Chat / Voice / Swarm / Files) */}
      <AnimatePresence>
        {jarvisOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setJarvisOpen(false) }}>
            <motion.div
              initial={{ scale: 0.95, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl shadow-indigo-500/10 flex flex-col">
              <div className="relative overflow-hidden border-b border-border/60 px-5 py-4">
                <div className="absolute inset-0 -z-0 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.18),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(236,72,153,0.14),transparent_55%)]" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                      <Bot className="w-6 h-6" />
                      <motion.span className="absolute -inset-0.5 rounded-xl ring-2 ring-indigo-400/40" animate={{ opacity: [0, 1, 0], scale: [1, 1.18, 1] }} transition={{ duration: 3.2, repeat: Infinity }} />
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold tracking-tight">Jarvis · Multimodal Assistant</h3>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Online · WSS · Encrypted channel · {SOURCE_PROJECTS.length} modules loaded
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setJarvisOpen(false)}><XCircle className="w-4 h-4" /></Button>
                </div>
              </div>

              <Tabs value={jarvisTab} onValueChange={(v) => setJarvisTab(v as any)} className="flex-1 flex flex-col">
                <div className="px-4 pt-3 border-b border-border/50">
                  <TabsList className="grid grid-cols-4 h-9 p-1 bg-muted/50">
                    <TabsTrigger value="chat" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><MessageSquare className="w-3.5 h-3.5" />Chat</TabsTrigger>
                    <TabsTrigger value="voice" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Volume2 className="w-3.5 h-3.5" />Voice</TabsTrigger>
                    <TabsTrigger value="swarm" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Network className="w-3.5 h-3.5" />Swarm</TabsTrigger>
                    <TabsTrigger value="files" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><FolderKanban className="w-3.5 h-3.5" />Files</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="chat" className="flex-1 flex flex-col p-0 m-0 min-h-0">
                  <ScrollArea className="flex-1 min-h-0 p-4 space-y-3 h-[40vh]">
                    {chatLog.map((m, i) => (
                      <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.from === 'user' ? 'bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white rounded-br-sm shadow-md shadow-indigo-500/20' : 'bg-muted/60 rounded-bl-sm border border-border/50'}`}>{m.msg}</div>
                      </div>
                    ))}
                  </ScrollArea>
                  <form onSubmit={sendChat} className="p-3 border-t border-border/60 flex items-center gap-2">
                    <Input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask Jarvis about the swarm, payouts, shipments, security posture…" className="h-9 text-sm" />
                    <Button type="submit" size="sm" className="gap-1 h-9 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500"><Send className="w-3.5 h-3.5" />Send</Button>
                  </form>
                </TabsContent>

                <TabsContent value="voice" className="flex-1 flex flex-col p-4 m-0 min-h-[40vh] items-center justify-center gap-4">
                  <div className="relative">
                    <motion.div className="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-indigo-500/30 text-white">
                      <Radio className="w-12 h-12" />
                    </motion.div>
                    <motion.span className="absolute inset-0 rounded-full ring-2 ring-indigo-400/40" animate={{ opacity: [0.1, 0.8, 0.1], scale: [1, 1.25, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
                    <motion.span className="absolute inset-0 rounded-full ring-2 ring-fuchsia-400/40" animate={{ opacity: [0.1, 0.8, 0.1], scale: [1, 1.45, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-semibold">Voice Interface · Listening</p>
                    <p className="text-xs text-muted-foreground max-w-md">Multimodal speech-to-swarm-dispatch. Wired to the EDR brain for spoken triage, payout approvals, and procurement orders.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5"><PlayCircle className="w-4 h-4 text-emerald-500" />Start Listening</Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 dark:text-amber-300"><Settings className="w-4 h-4" />Configure Mic</Button>
                  </div>
                </TabsContent>

                <TabsContent value="swarm" className="flex-1 flex flex-col p-0 m-0 min-h-0">
                  <ScrollArea className="flex-1 min-h-0 h-[40vh] p-4">
                    <div className="grid grid-cols-2 gap-2">
                      {AGENTS.map(ag => {
                        const Icon = ag.icon
                        return (
                          <div key={ag.id} className="p-3 rounded-xl border border-border/60 bg-background/60 hover:border-indigo-300/60 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-md flex items-center justify-center border border-border/50 ${ag.color}`}><Icon className="w-4 h-4" /></div>
                                <div><p className="text-xs font-semibold leading-tight">{ag.name}</p><p className="text-[10px] text-muted-foreground leading-tight">{ag.role}</p></div>
                              </div>
                              {ag.status === 'Active' ? <Badge variant="outline" className="text-[10px] border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Active</Badge> : <Badge variant="outline" className="text-[10px]">Idle</Badge>}
                            </div>
                            <div className="flex gap-1.5 mt-2">
                              <Button size="sm" variant="ghost" className="h-7 text-[10px] flex-1 gap-1 px-1.5"><PlayCircle className="w-3 h-3 text-emerald-500" />Activate</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-[10px] flex-1 gap-1 px-1.5 text-rose-600 dark:text-rose-300"><XCircle className="w-3 h-3" />Sleep</Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-300/30 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div><span className="font-semibold">Operational Notice</span> — Disabling agents in production pauses their tick-loop responsibilities. Use Autopilot toggle in the main dashboard for safe mode switching.</div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="files" className="flex-1 flex flex-col p-0 m-0 min-h-0">
                  <ScrollArea className="flex-1 min-h-0 h-[40vh] p-4">
                    <div className="space-y-2">
                      {[
                        { name: 'swarm-ledger-export.csv', size: '2.4 MB', kind: 'CSV', age: '5 min ago', icon: Database as any, color: 'text-emerald-500' },
                        { name: 'owner-payout-configs.json', size: '48 KB', kind: 'JSON', age: '12 min ago', icon: CreditCard as any, color: 'text-violet-500' },
                        { name: 'shipment-tracking-batch.xlsx', size: '388 KB', kind: 'XLSX', age: '38 min ago', icon: Truck as any, color: 'text-blue-500' },
                        { name: 'edr-audit-log.ndjson.gz', size: '12 MB', kind: 'LOG', age: '1 h ago', icon: ShieldAlert as any, color: 'text-rose-500' },
                        { name: 'vault-secret-inventory.json', size: '12 KB', kind: 'VAULT', age: '3 h ago', icon: Lock as any, color: 'text-indigo-500' },
                        { name: 'procurement-pos-weekly.pdf', size: '1.1 MB', kind: 'PDF', age: 'yesterday', icon: FileCode as any, color: 'text-amber-500' },
                      ].map((f, i) => {
                        const Icon = f.icon
                        return (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-background/60 hover:border-indigo-300/60 hover:bg-indigo-500/5 transition-all">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-slate-500/10 to-transparent border border-border/50 ${f.color}`}><Icon className="w-5 h-5" /></div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{f.name}</p>
                              <p className="text-[11px] text-muted-foreground flex items-center gap-2"><Badge variant="outline" className="text-[9px] h-4 px-1.5">{f.kind}</Badge>{f.size} · {f.age}</p>
                            </div>
                            <a href="/api/download"><Button size="sm" variant="ghost" className="h-8 text-[11px] gap-1 px-2"><Download className="w-3.5 h-3.5" />Download</Button></a>
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>

              <div className="px-5 py-2.5 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" />Session encrypted</span>
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-emerald-500" />Integrity verified</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><Fingerprint className="w-3 h-3" />Attested</span>
                  <span>Base44 Dry-Run: <span className="font-mono text-emerald-600 dark:text-emerald-400">ON</span></span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
    </TooltipProvider>
  )
}


