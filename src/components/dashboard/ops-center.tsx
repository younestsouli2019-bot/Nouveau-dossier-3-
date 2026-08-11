'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  ShieldCheck,
  ArrowRight,
  Rocket,
  Workflow,
  Send,
  PackageCheck,
  Play,
  RotateCcw,
  Timer,
  Banknote,
  Coins,
  AlertOctagon,
  Package,
  Truck,
  FileWarning,
  Wrench,
  CircleCheck,
  CircleX,
  CircleAlert,
  DollarSign,
  Layers,
  Inbox,
  Ban,
  Loader2,
  Wallet,
  Globe,
  Copy,
  Check,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DiagnosisItem {
  id: string; severity: 'critical' | 'high' | 'medium' | 'low'; category: string
  title: string; description: string; entityType: string; entityId: string
  entityLabel: string; amount?: number; actionable: boolean
  resolutionAction?: string; resolutionParams?: Record<string, string>
}

interface DiagnosisResponse {
  healthScore: number
  issues: { total: number; critical: number; high: number; medium: number; low: number }
  blockedAmount: number; actionableCount: number; items: DiagnosisItem[]
  categoryBreakdown?: { category: string; count: number; severity: string }[]
}

interface AuditLogEntry {
  id: string; entityType: string; entityId: string; action: string
  oldValue: string | null; newValue: string | null; reason: string | null
  performedBy: string; createdAt: string
}

interface TransactionLogEntry {
  id: string; category: string; status: string; amount: number; currency: string
  transactionDate: string; referenceId: string | null; description: string | null
  payoutBatchId: string | null; payoutItemId: string | null; provider: string | null
  providerTxId: string | null; errorCode: string | null; errorMessage: string | null
  batchNumber: string | null; batchStatus: string | null
}

interface AutoPilotStatus {
  autoPilotActive: boolean; needsAttention: number
  pipeline: {
    pendingApprovalBatches: number; approvedBatches: number; processingBatches: number
    failedBatches: number; completedBatches: number; pendingItems: number
    undeliveredItems: number; unnotifiedItems: number; unbatchedRevenue: number; pendingRevenue: number
    submittedToPaypalBatches: number; unclaimedItems: number
  }
  runs: { id: string; trigger: string; phase: string; status: string; itemsAffected: number; amountAffected: number; details: string; durationMs: number; createdAt: string }[]
}

interface PhaseResult { phase: string; status: string; itemsAffected: number; amountAffected: number; details: string; durationMs: number }

interface CryptoSettlement {
  id: string; txHash: string; type: string; network: string; token: string
  amount: number; gasUsed: number; status: string; recipientAddress: string | null
  ownerWallet: string | null; isOwner: boolean; misplaced: boolean; recovered: boolean
  recoveredTxHash: string | null; recoveryAmount: number | null; recoveryStatus: string | null
  failureReason: string | null; txTime: string; createdAt: string; updatedAt: string
  _verification?: { isOwner: boolean; ownerWallet: string | undefined; anomaly: boolean; anomalyReason?: string }
}

interface CryptoSummary {
  total: number; ownerRouted: number; anomalies: number; confirmedAnomalies: number
  networksTotal: number; networksWithAnomalies: number
  totalUsd: number; ownerUsd: number; anomalyUsd: number
  networkBreakdown: Record<string, { total: number; ownerRouted: number; anomalies: number; confirmed: number; pending: number; failed: number; totalUsd: number; ownerUsd: number }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtN = (n: number) => new Intl.NumberFormat('en-US').format(n)

const severityConfig = {
  critical: { color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20', badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25' },
  high: { color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20', badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25' },
  medium: { color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25' },
  low: { color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
} as const

function healthColor(score: number) {
  if (score < 40) return { ring: 'stroke-red-500', text: 'text-red-500', glow: 'drop-shadow-[0_0_12px_rgba(239,68,68,0.3)]' }
  if (score <= 70) return { ring: 'stroke-amber-500', text: 'text-amber-500', glow: 'drop-shadow-[0_0_12px_rgba(245,158,11,0.3)]' }
  return { ring: 'stroke-emerald-500', text: 'text-emerald-500', glow: 'drop-shadow-[0_0_12px_rgba(16,185,129,0.3)]' }
}

const phaseKeyMap: Record<string, string[]> = {
  settle: ['confirm_pending_revenue', 'batch_unassigned_revenue'],
  approve: ['auto_approve_batches'],
  process: ['advance_approved_batches', 'advance_processing_batches', 'advance_paypal_batches', 'retry_failed_items', 'retry_failed_batches', 'retry_unclaimed_items', 'fix_timestamps', 'reconcile_transactions', 'resolve_orphan_transactions'],
  deliver: ['confirm_deliveries', 'notify_recipients'],
}

const phaseLabels = {
  settle: { label: 'Settle', icon: Coins },
  approve: { label: 'Approve', icon: CircleCheck },
  process: { label: 'Process', icon: CogIcon },
  deliver: { label: 'Deliver', icon: Truck },
} as const

function CogIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function getPhaseStatus(phaseGroup: string, autoPilotData: AutoPilotStatus | undefined, runResults: PhaseResult[] | null): 'clear' | 'needed' | 'done' | 'error' {
  if (runResults) {
    const phaseKeys = phaseKeyMap[phaseGroup] || []
    const groupResults = runResults.filter(r => phaseKeys.includes(r.phase))
    if (groupResults.some(r => r.status === 'error')) return 'error'
    if (groupResults.length > 0 && groupResults.every(r => r.status === 'done')) return 'done'
    return 'done'
  }

  const p = autoPilotData?.pipeline
  if (!p) return 'clear'

  switch (phaseGroup) {
    case 'settle':
      return (p.pendingRevenue + p.unbatchedRevenue) > 0 ? 'needed' : 'clear'
    case 'approve':
      return (p.pendingApprovalBatches + p.approvedBatches) > 0 ? 'needed' : 'clear'
    case 'process':
      return (p.processingBatches + p.failedBatches + p.submittedToPaypalBatches + p.pendingItems + p.unclaimedItems) > 0 ? 'needed' : 'clear'
    case 'deliver':
      return (p.undeliveredItems + p.unnotifiedItems) > 0 ? 'needed' : 'clear'
    default:
      return 'clear'
  }
}

const phaseStatusDot: Record<string, string> = {
  clear: 'bg-emerald-500',
  needed: 'bg-amber-500',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
}

const phaseStatusBg: Record<string, string> = {
  clear: 'bg-emerald-500/10 border-emerald-500/20',
  needed: 'bg-amber-500/10 border-amber-500/20',
  done: 'bg-emerald-500/10 border-emerald-500/20',
  error: 'bg-red-500/10 border-red-500/20',
}

const statusBadgeConfig: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25',
  reversed: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/25',
}

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: 'easeOut' as const },
}

// ─── Crypto Helpers ─────────────────────────────────────────────────────────

const NETWORK_COLORS: Record<string, string> = {
  arbitrum: '#28A0F0',
  optimism: '#FF0420',
  base: '#0052FF',
  polygon_zkevm: '#8247E5',
  linea: '#61DFFF',
  scroll: '#FFDFB0',
}

const NETWORK_LABELS: Record<string, string> = {
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  base: 'Base',
  polygon_zkevm: 'Polygon zkEVM',
  linea: 'Linea',
  scroll: 'Scroll',
}

const TOKEN_COLORS: Record<string, string> = {
  USDC: 'bg-blue-500',
  ETH: 'bg-purple-500',
  WBTC: 'bg-amber-500',
}

const TX_TYPE_ICONS: Record<string, string> = {
  transfer: '↗',
  swap: '⇄',
  bridge_deposit: '⬇',
  bridge_withdraw: '⬆',
  contract_call: '⚙',
  approve: '✓',
}

const USD_RATES_CLIENT: Record<string, number> = { ETH: 3500, WBTC: 65000, USDC: 1 }
const cryptoToUsd = (token: string, amount: number) => (USD_RATES_CLIENT[token] || 0) * amount

const scrollbarStyles = `
  .ops-scroll::-webkit-scrollbar { width: 6px; }
  .ops-scroll::-webkit-scrollbar-track { background: transparent; }
  .ops-scroll::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
  .ops-scroll::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground)); }
  @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
`

// ─── Component ───────────────────────────────────────────────────────────────

export default function OpsCenter() {
  const queryClient = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)
  const [txCategoryFilter, setTxCategoryFilter] = useState<string>('all')
  const [txOpen, setTxOpen] = useState(false)
  const [runResults, setRunResults] = useState<PhaseResult[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [cryptoOpen, setCryptoOpen] = useState(false)
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const diagnosisQuery = useQuery<DiagnosisResponse>({
    queryKey: ['ops-diagnosis'],
    queryFn: () => fetch('/api/ops/diagnose').then(r => { if (!r.ok) throw new Error('Diagnose API failed'); return r.json() }),
  })

  const autoPilotQuery = useQuery<AutoPilotStatus>({
    queryKey: ['ops-autopilot'],
    queryFn: () => fetch('/api/ops/auto-pilot').then(r => { if (!r.ok) throw new Error('Auto-pilot API failed'); return r.json() }),
    refetchInterval: runResults ? false : 5000,
  })

  const auditLogQuery = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ['ops-audit-log'],
    queryFn: () => fetch('/api/ops/audit-log').then(r => { if (!r.ok) throw new Error('Audit log API failed'); return r.json() }),
  })

  const txLogsQuery = useQuery<{ logs: TransactionLogEntry[]; summary: { total: number; completed: number; failed: number; pending: number; orphanCount: number; totalAmount: number; completedAmount: number } }>({
    queryKey: ['ops-tx-logs', txCategoryFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (txCategoryFilter !== 'all') params.set('category', txCategoryFilter)
      return fetch(`/api/ops/transaction-logs?${params}`).then(r => { if (!r.ok) throw new Error('Transaction logs API failed'); return r.json() })
    },
    enabled: txOpen,
  })

  // ── Crypto Settlements Query ────────────────────────────────────────────────

  const cryptoQuery = useQuery<{
    settlements: CryptoSettlement[]
    summary: CryptoSummary
    ownerWallets: Record<string, string | undefined>
  }>({
    queryKey: ['ops-crypto-settlements'],
    queryFn: () => fetch('/api/ops/crypto-settlements').then(r => { if (!r.ok) throw new Error('Crypto settlements API failed'); return r.json() }),
    enabled: cryptoOpen,
  })

  const ownerConfigQuery = useQuery({
    queryKey: ['owner-config'],
    queryFn: () => fetch('/api/ops/owner-config').then(r => { if (!r.ok) throw new Error('Owner config API failed'); return r.json() }),
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const resolveMutation = useMutation({
    mutationFn: (params: { action: string; itemId?: string; batchId?: string; eventId?: string; transactionLogId?: string; cryptoSettlementId?: string }) =>
      fetch('/api/ops/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }).then(r => r.json()),
    onSuccess: (data: { ok?: boolean; message?: string; error?: string }) => {
      if (data?.error) {
        toast.error(data.error)
        return
      }
      if (data?.ok === false) {
        toast.error(data.message || 'Resolution failed')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['ops-diagnosis'] })
      queryClient.invalidateQueries({ queryKey: ['ops-autopilot'] })
      queryClient.invalidateQueries({ queryKey: ['ops-audit-log'] })
      queryClient.invalidateQueries({ queryKey: ['ops-crypto-settlements'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(data?.message || 'Issue resolved successfully')
    },
    onError: (err) => toast.error('Failed to resolve issue'),
  })

  const resolveAllMutation = useMutation({
    mutationFn: () =>
      fetch('/api/ops/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_all' }),
      }).then(r => r.json()),
    onSuccess: (data: { ok?: boolean; message?: string; error?: string; resolved?: number }) => {
      if (data?.error) {
        toast.error(data.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['ops-diagnosis'] })
      queryClient.invalidateQueries({ queryKey: ['ops-autopilot'] })
      queryClient.invalidateQueries({ queryKey: ['ops-audit-log'] })
      queryClient.invalidateQueries({ queryKey: ['ops-crypto-settlements'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(data?.message || `All ${data?.resolved ?? 0} issues resolved`)
    },
    onError: (err) => toast.error('Failed to resolve all issues'),
  })

  const autoPilotMutation = useMutation({
    mutationFn: () =>
      fetch('/api/ops/auto-pilot', { method: 'POST' }).then(r => r.json()),
    onMutate: () => {
      setIsRunning(true)
      setRunResults(null)
    },
    onSuccess: (data) => {
      setRunResults(data.phases || [])
      setIsRunning(false)
      queryClient.invalidateQueries({ queryKey: ['ops-diagnosis'] })
      queryClient.invalidateQueries({ queryKey: ['ops-autopilot'] })
      queryClient.invalidateQueries({ queryKey: ['ops-audit-log'] })
      queryClient.invalidateQueries({ queryKey: ['ops-tx-logs'] })
      queryClient.invalidateQueries({ queryKey: ['ops-crypto-settlements'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      if (data.success) {
        toast.success(`Auto-Pilot complete: ${data.totalItemsAffected} items in ${data.totalDurationMs}ms`)
      } else {
        toast.error('Auto-Pilot encountered errors')
      }
    },
    onError: () => {
      setIsRunning(false)
      toast.error('Auto-Pilot failed to execute')
    },
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const diag = diagnosisQuery.data
  const ap = autoPilotQuery.data
  const auditLogs = auditLogQuery.data?.logs || []
  const txData = txLogsQuery.data
  const cryptoData = cryptoQuery.data
  const cryptoSettlements = cryptoData?.settlements || []
  const cryptoSummary = cryptoData?.summary

  const filteredItems = (diag?.items || []).filter(item => {
    if (severityFilter !== 'all' && item.severity !== severityFilter) return false
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
    return true
  }) || []

  const categories = [...new Set((diag?.items || []).map(i => i.category))]

  const anomalousSettlements = cryptoSettlements.filter(
    s => s._verification?.anomaly
  )

  // ── Render helpers ─────────────────────────────────────────────────────────

  function handleResolve(item: DiagnosisItem) {
    if (!item.resolutionAction) return
    const params: { action: string; itemId?: string; batchId?: string; eventId?: string; transactionLogId?: string; cryptoSettlementId?: string } = { action: item.resolutionAction }
    if (item.entityType === 'item') params.itemId = item.entityId
    else if (item.entityType === 'batch') params.batchId = item.entityId
    else if (item.entityType === 'revenue') params.eventId = item.entityId
    else if (item.entityType === 'transaction') params.transactionLogId = item.entityId
    resolveMutation.mutate(params)
  }

  function handleCopyWallet(wallet: string, key: string) {
    navigator.clipboard.writeText(wallet)
    setCopiedWallet(key)
    setTimeout(() => setCopiedWallet(null), 2000)
  }

  // ─── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{scrollbarStyles}</style>
      <div className="space-y-6">
        {/* ── 1. Health Score & Summary ──────────────────────────────────────── */}
        <motion.div {...fadeIn}>
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                {/* Health Score Circle */}
                <div className="flex items-center gap-6">
                  {diagnosisQuery.isLoading ? (
                    <Skeleton className="h-28 w-28 rounded-full" />
                  ) : (
                    <div className={`relative flex items-center justify-center ${healthColor(diag?.healthScore ?? 0).glow}`}>
                      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
                        <circle
                          cx="60" cy="60" r="52" fill="none" strokeWidth="8" strokeLinecap="round"
                          className={healthColor(diag?.healthScore ?? 0).ring}
                          strokeDasharray={`${2 * Math.PI * 52}`}
                          strokeDashoffset={`${2 * Math.PI * 52 * (1 - (diag?.healthScore ?? 0) / 100)}`}
                          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className={`text-3xl font-bold ${healthColor(diag?.healthScore ?? 0).text}`}>
                          {diag?.healthScore ?? 0}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Health</span>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-medium text-muted-foreground">System Health</h3>
                    <p className="text-sm text-muted-foreground">
                      {diag?.healthScore != null ? (diag.healthScore >= 80 ? 'All systems operational' : diag.healthScore >= 50 ? 'Issues detected — review recommended' : 'Critical issues require attention') : 'Loading...'}
                    </p>
                  </div>
                </div>

                {/* Severity Badges */}
                <div className="flex flex-wrap items-center gap-3">
                  {diagnosisQuery.isLoading ? (
                    <>
                      <Skeleton className="h-9 w-20" />
                      <Skeleton className="h-9 w-16" />
                      <Skeleton className="h-9 w-20" />
                      <Skeleton className="h-9 w-14" />
                    </>
                  ) : diag ? (
                    <>
                      <Badge variant="outline" className={`${severityConfig.critical.badge} px-3 py-1 text-xs font-semibold`}>
                        <AlertOctagon className="mr-1.5 h-3 w-3" />
                        Critical {diag?.issues?.critical ?? 0}
                      </Badge>
                      <Badge variant="outline" className={`${severityConfig.high.badge} px-3 py-1 text-xs font-semibold`}>
                        <AlertTriangle className="mr-1.5 h-3 w-3" />
                        High {diag?.issues?.high ?? 0}
                      </Badge>
                      <Badge variant="outline" className={`${severityConfig.medium.badge} px-3 py-1 text-xs font-semibold`}>
                        <CircleAlert className="mr-1.5 h-3 w-3" />
                        Medium {diag?.issues?.medium ?? 0}
                      </Badge>
                      <Badge variant="outline" className={`${severityConfig.low.badge} px-3 py-1 text-xs font-semibold`}>
                        <CheckCircle2 className="mr-1.5 h-3 w-3" />
                        Low {diag?.issues?.low ?? 0}
                      </Badge>
                    </>
                  ) : null}
                </div>

                {/* Blocked Amount & Actionable */}
                <div className="flex flex-col gap-2">
                  {diagnosisQuery.isLoading ? (
                    <>
                      <Skeleton className="h-6 w-36" />
                      <Skeleton className="h-5 w-28" />
                    </>
                  ) : diag ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium">Blocked:</span>
                        <span className="text-lg font-bold text-red-500">{fmt(diag?.blockedAmount ?? 0)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Wrench className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground">{diag?.actionableCount ?? 0}</span> actionable
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Owner Config Status */}
        {ownerConfigQuery.data && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            ownerConfigQuery.data.owner.configured
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-red-500/20 bg-red-500/5'
          }`}>
            {ownerConfigQuery.data.owner.configured ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <AlertOctagon className="h-3.5 w-3.5 text-red-500 shrink-0" />
            )}
            <span className={ownerConfigQuery.data.owner.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {ownerConfigQuery.data.owner.configured
                ? `Owner: ${ownerConfigQuery.data.owner.name} — ${ownerConfigQuery.data.networksConfigured}/${ownerConfigQuery.data.networksTotal} wallets configured`
                : 'Owner not configured — set OWNER_NAME and OWNER_EMAIL in GitHub Secrets'}
            </span>
          </div>
        )}

        {/* ── 2. Auto-Pilot Command Center ─────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.05 }}>
          <Card className="border-2 border-dashed border-emerald-500/40 dark:border-emerald-500/30">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                    <Rocket className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      Auto-Pilot
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Live
                      </span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Autonomous pipeline engine — hands-free resolution</p>
                  </div>
                </div>
                <Button
                  onClick={() => autoPilotMutation.mutate()}
                  disabled={isRunning || autoPilotMutation.isPending}
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {isRunning || autoPilotMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running...</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" /> Launch Auto-Pilot</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* 4-Phase Pipeline Viz */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
                {(['settle', 'approve', 'process', 'deliver'] as const).map((pg, idx) => {
                  const cfg = phaseLabels[pg]
                  const status = getPhaseStatus(pg, ap, runResults)
                  const Icon = cfg.icon
                  return (
                    <div key={pg} className="flex items-center gap-2">
                      <div className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 ${phaseStatusBg[status]}`}>
                        <Icon className={`h-4 w-4 ${status === 'error' ? 'text-red-500' : status === 'needed' ? 'text-amber-500' : 'text-emerald-500'}`} />
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold">{cfg.label}</span>
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${phaseStatusDot[status]}`} />
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {status === 'done' ? 'Done' : status === 'error' ? 'Error' : status === 'needed' ? 'Needed' : 'Clear'}
                            </span>
                          </div>
                        </div>
                      </div>
                      {idx < 3 && (
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 sm:mx-1" />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Results Banner */}
              {runResults && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4"
                >
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <PackageCheck className="h-4 w-4 text-emerald-500" />
                      <span className="font-medium">Items affected:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {runResults.reduce((s, r) => s + r.itemsAffected, 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4 text-emerald-500" />
                      <span className="font-medium">Amount:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {fmt(runResults.reduce((s, r) => s + r.amountAffected, 0))}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Timer className="h-4 w-4 text-emerald-500" />
                      <span className="font-medium">Duration:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {runResults.reduce((s, r) => s + r.durationMs, 0)}ms
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {runResults.map(r => (
                      <Badge
                        key={r.phase}
                        variant="outline"
                        className={`text-[10px] ${r.status === 'done' || r.status === 'success' ? 'border-emerald-500/25 text-emerald-600 dark:text-emerald-400' : 'border-red-500/25 text-red-600 dark:text-red-400'}`}
                      >
                        {r.status === 'done' || r.status === 'success' ? <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> : <XCircle className="mr-1 h-2.5 w-2.5" />}
                        {r.phase.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 3. Pipeline Overview ─────────────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.1 }}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {autoPilotQuery.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))
            ) : ap?.pipeline ? (
              <>
                <StatCard
                  icon={<Clock className="h-4 w-4 text-amber-500" />}
                  label="Pending Approval Batches"
                  value={fmtN(ap.pipeline.pendingApprovalBatches)}
                  color="text-amber-500"
                />
                <StatCard
                  icon={<Send className="h-4 w-4 text-orange-500" />}
                  label="Submitted to PayPal"
                  value={fmtN(ap.pipeline.submittedToPaypalBatches)}
                  color="text-orange-500"
                />
                <StatCard
                  icon={<Loader2 className="h-4 w-4 text-emerald-500" />}
                  label="Processing Items"
                  value={fmtN(ap.pipeline.pendingItems)}
                  color="text-emerald-500"
                />
                <StatCard
                  icon={<Inbox className="h-4 w-4 text-purple-500" />}
                  label="Unclaimed Items"
                  value={fmtN(ap.pipeline.unclaimedItems)}
                  color="text-purple-500"
                />
                <StatCard
                  icon={<XCircle className="h-4 w-4 text-red-500" />}
                  label="Failed Items"
                  value={fmtN(ap.pipeline.failedBatches)}
                  color="text-red-500"
                />
                <StatCard
                  icon={<Coins className="h-4 w-4 text-amber-600" />}
                  label="Unbatched Revenue"
                  value={`${fmtN(ap.pipeline.unbatchedRevenue)} events`}
                  color="text-amber-600"
                />
              </>
            ) : null}
          </div>
        </motion.div>

        {/* ── 4. Transaction Log Cross-Reference ───────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.15 }}>
          <Collapsible open={txOpen} onOpenChange={setTxOpen}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10">
                        <FileWarning className="h-4.5 w-4.5 text-orange-500" />
                      </div>
                      <div className="text-left">
                        <CardTitle className="text-base">Transaction Log Cross-Reference</CardTitle>
                        <p className="text-xs text-muted-foreground">Reconcile provider transactions with payout items</p>
                      </div>
                    </div>
                    <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${txOpen ? 'rotate-180' : ''}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-6 pb-6">
                  {/* Summary bar */}
                  {txLogsQuery.isLoading ? (
                    <div className="mb-4 flex gap-4">
                      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-24" />)}
                    </div>
                  ) : txData?.summary ? (
                    <div className="mb-4 flex flex-wrap gap-3">
                      <Badge variant="outline" className="border-border px-2.5 py-1 text-xs">Total: {txData.summary.total}</Badge>
                      <Badge variant="outline" className={statusBadgeConfig.completed + ' px-2.5 py-1 text-xs'}>Completed: {txData.summary.completed}</Badge>
                      <Badge variant="outline" className={statusBadgeConfig.pending + ' px-2.5 py-1 text-xs'}>Pending: {txData.summary.pending}</Badge>
                      <Badge variant="outline" className={statusBadgeConfig.failed + ' px-2.5 py-1 text-xs'}>Failed: {txData.summary.failed}</Badge>
                      <Badge variant="outline" className="border-orange-500/25 bg-orange-500/10 px-2.5 py-1 text-xs text-orange-600 dark:text-orange-400">Orphans: {txData.summary.orphanCount}</Badge>
                    </div>
                  ) : null}

                  {/* Category filter */}
                  <div className="mb-4">
                    <Select value={txCategoryFilter} onValueChange={setTxCategoryFilter}>
                      <SelectTrigger size="sm" className="w-[180px]">
                        <SelectValue placeholder="Filter category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="withdrawal">Withdrawal</SelectItem>
                        <SelectItem value="deposit">Deposit</SelectItem>
                        <SelectItem value="refund">Refund</SelectItem>
                        <SelectItem value="fee">Fee</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Table */}
                  <div className="max-h-96 overflow-y-auto rounded-lg border ops-scroll">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Amount</TableHead>
                          <TableHead className="text-xs">Provider</TableHead>
                          <TableHead className="text-xs">Reference</TableHead>
                          <TableHead className="text-xs">Batch</TableHead>
                          <TableHead className="text-xs">Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {txLogsQuery.isLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 8 }).map((_, j) => (
                                <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : !txData?.logs || txData.logs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No transactions found</TableCell>
                          </TableRow>
                        ) : (
                          txData.logs.map(log => {
                            const isOrphan = log.category === 'withdrawal' && !log.payoutItemId
                            return (
                              <TableRow key={log.id} className={isOrphan ? 'border-l-4 border-l-orange-500' : ''}>
                                <TableCell className="text-xs whitespace-nowrap">{format(new Date(log.transactionDate), 'MMM d, HH:mm')}</TableCell>
                                <TableCell className="text-xs capitalize">{log.category}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`text-[10px] ${statusBadgeConfig[log.status] || statusBadgeConfig.pending}`}>
                                    {log.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono">{fmt(log.amount)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{log.provider || '—'}</TableCell>
                                <TableCell className="text-xs font-mono text-muted-foreground">{log.referenceId || '—'}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{log.batchNumber || '—'}</TableCell>
                                <TableCell className="text-xs text-red-500 max-w-[120px] truncate">{log.errorMessage || '—'}</TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </motion.div>

        {/* ── 5. Issue List ────────────────────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.2 }}>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
                    <AlertTriangle className="h-4.5 w-4.5 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Detected Issues</CardTitle>
                    <p className="text-xs text-muted-foreground">{filteredItems.length} of {diag?.issues.total ?? 0} shown</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {diag?.actionableCount != null && diag.actionableCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolveAllMutation.mutate()}
                      disabled={resolveAllMutation.isPending}
                      className="border-emerald-500/25 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      {resolveAllMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-2 h-3.5 w-3.5" />}
                      Resolve All
                    </Button>
                  )}
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger size="sm" className="w-[160px]">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Severity tabs */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(['all', 'critical', 'high', 'medium', 'low'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      severityFilter === s
                        ? 'bg-foreground text-background'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {s === 'all' ? `All (${diag?.issues.total ?? 0})` : s === 'critical' ? `Critical (${diag?.issues.critical ?? 0})` : s === 'high' ? `High (${diag?.issues.high ?? 0})` : s === 'medium' ? `Medium (${diag?.issues.medium ?? 0})` : `Low (${diag?.issues.low ?? 0})`}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-96 space-y-2 overflow-y-auto ops-scroll">
                {diagnosisQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-4">
                      <Skeleton className="mb-2 h-4 w-48" />
                      <Skeleton className="h-3 w-64" />
                    </div>
                  ))
                ) : filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CheckCircle2 className="mb-2 h-10 w-10 text-emerald-500/50" />
                    <p className="text-sm text-muted-foreground">No issues found in this filter</p>
                  </div>
                ) : (
                  filteredItems.map(item => {
                    const isExpanded = expandedIssue === item.id
                    const sev = severityConfig[item.severity]
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg border p-4 transition-colors hover:bg-muted/30 ${sev.bg}`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`${sev.badge} text-[10px] uppercase font-bold`}>
                              {item.severity}
                            </Badge>
                            <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                              {item.category}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{item.entityLabel}</span>
                            {item.amount != null && item.amount > 0 && (
                              <span className="text-xs font-mono font-medium">{fmt(item.amount)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.actionable && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-emerald-500/25 text-[11px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                                disabled={resolveMutation.isPending}
                                onClick={() => handleResolve(item)}
                              >
                                {resolveMutation.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Wrench className="mr-1.5 h-3 w-3" />}
                                Fix
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setExpandedIssue(isExpanded ? null : item.id)}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>

                        <p className="mt-1.5 text-sm font-medium">{item.title}</p>

                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2"
                          >
                            <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                            {item.resolutionAction && (
                              <p className="mt-1 text-[10px] text-muted-foreground/70">
                                Action: <code className="rounded bg-muted px-1 py-0.5 font-mono">{item.resolutionAction}</code>
                              </p>
                            )}
                          </motion.div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 6. Audit Trail ───────────────────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.25 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-500/10">
                  <Activity className="h-4.5 w-4.5 text-gray-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Audit Trail</CardTitle>
                  <p className="text-xs text-muted-foreground">Most recent 20 actions</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-96 overflow-y-auto rounded-lg border ops-scroll">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Actor</TableHead>
                      <TableHead className="text-xs">Entity</TableHead>
                      <TableHead className="text-xs">Action</TableHead>
                      <TableHead className="text-xs">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No audit entries yet</TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.slice(0, 20).map(entry => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-xs whitespace-nowrap">{format(new Date(entry.createdAt), 'MMM d, HH:mm:ss')}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                entry.performedBy === 'auto-pilot'
                                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : entry.performedBy === 'ops-auto-resolver'
                                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    : 'border-border text-muted-foreground'
                              }`}
                            >
                              {entry.performedBy}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-mono text-muted-foreground">{entry.entityType}</span>
                            <span className="ml-1 text-muted-foreground/50 truncate max-w-[80px] inline-block align-bottom">{entry.entityId.slice(0, 8)}</span>
                          </TableCell>
                          <TableCell className="text-xs font-medium">{entry.action}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {entry.reason || entry.newValue || '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 7. Auto-Pilot Run History ────────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.3 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                  <RotateCcw className="h-4.5 w-4.5 text-emerald-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Auto-Pilot Run History</CardTitle>
                  <p className="text-xs text-muted-foreground">Recent phase executions</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-96 overflow-y-auto rounded-lg border ops-scroll">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Phase</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Items</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs text-right">Duration</TableHead>
                      <TableHead className="text-xs">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {autoPilotQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : !ap?.runs || ap.runs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No auto-pilot runs yet</TableCell>
                      </TableRow>
                    ) : (
                      ap.runs.map(run => (
                        <TableRow key={run.id}>
                          <TableCell className="text-xs whitespace-nowrap">{format(new Date(run.createdAt), 'MMM d, HH:mm:ss')}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{run.phase.replace(/_/g, ' ')}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${run.status === 'success' || run.status === 'done' ? statusBadgeConfig.completed : statusBadgeConfig.failed}`}
                            >
                              {run.status === 'success' || run.status === 'done' ? <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> : <XCircle className="mr-1 h-2.5 w-2.5" />}
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">{run.itemsAffected}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{run.amountAffected > 0 ? fmt(run.amountAffected) : '—'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{run.durationMs}ms</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{run.details}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 8. Crypto Settlement Ledger ────────────────────────────────────── */}
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.35 }}>
          <Collapsible open={cryptoOpen} onOpenChange={setCryptoOpen}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
                        <Wallet className="h-4.5 w-4.5 text-purple-500" />
                      </div>
                      <div className="text-left">
                        <CardTitle className="flex items-center gap-2 text-base">
                          Crypto Settlement Ledger
                          {cryptoSummary && cryptoSummary.anomalies > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                              {cryptoSummary.anomalies} anomaly{cryptoSummary.anomalies !== 1 ? 'ies' : 'y'}
                            </span>
                          )}
                          {cryptoSummary && cryptoSummary.anomalies === 0 && cryptoSummary.total > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                              All routed to owner
                            </span>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">On-chain settlement tracking across L2 networks — owner wallet verification</p>
                      </div>
                    </div>
                    <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${cryptoOpen ? 'rotate-180' : ''}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-6 pb-6 space-y-6">
                  {/* A. Summary Cards Row */}
                  {cryptoQuery.isLoading ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                      ))}
                    </div>
                  ) : cryptoSummary ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                        <Card className="border-emerald-500/20">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs text-muted-foreground">Owner Routed</p>
                                <p className="text-xl font-bold text-emerald-500">{cryptoSummary.ownerRouted}/{cryptoSummary.total}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                        <Card className={cryptoSummary.anomalies > 0 ? 'border-red-500/20' : 'border-border'}>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${cryptoSummary.anomalies > 0 ? 'bg-red-500/10' : 'bg-muted/50'}`}>
                                {cryptoSummary.anomalies > 0 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs text-muted-foreground">Anomalies</p>
                                <p className={`text-xl font-bold ${cryptoSummary.anomalies > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{cryptoSummary.anomalies}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                        <Card className="border-purple-500/20">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                                <DollarSign className="h-4 w-4 text-purple-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs text-muted-foreground">Total USD Value</p>
                                <p className="text-xl font-bold text-purple-500">{fmt(cryptoSummary.totalUsd)}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                        <Card className="border-border">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs text-muted-foreground">Active Networks</p>
                                <p className="text-xl font-bold">{cryptoSummary.networksTotal}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    </div>
                  ) : null}

                  {/* B. Network Breakdown */}
                  {cryptoQuery.isLoading ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Card key={i}><CardContent className="p-4"><Skeleton className="h-28 w-full" /></CardContent></Card>
                      ))}
                    </div>
                  ) : cryptoSummary?.networkBreakdown ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(['arbitrum', 'optimism', 'base', 'polygon_zkevm', 'linea', 'scroll'] as const).map(network => {
                        const nb = cryptoSummary.networkBreakdown[network]
                        if (!nb) return null
                        const color = NETWORK_COLORS[network]
                        const ownerWallet = cryptoData?.ownerWallets[network] || '—'
                        const hasAnomalies = nb.anomalies > 0
                        const allOwner = nb.ownerRouted === nb.total && nb.total > 0
                        const borderColor = hasAnomalies ? 'border-l-red-500' : allOwner ? 'border-l-emerald-500' : 'border-l-border'

                        return (
                          <motion.div key={network} whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                            <Card className={`border-l-4 ${borderColor}`}>
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                                    <span className="text-sm font-semibold">{NETWORK_LABELS[network]}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {allOwner ? (
                                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25">
                                        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        Owner
                                      </Badge>
                                    ) : hasAnomalies ? (
                                      <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25">
                                        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                                        {nb.anomalies} anomaly{nb.anomalies !== 1 ? 'ies' : 'y'}
                                      </Badge>
                                    ) : null}
                                    <Badge variant="outline" className="text-[10px] border-border">
                                      {nb.total} txns
                                    </Badge>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                  <div className="text-muted-foreground">Owner: <span className={`font-medium ${allOwner ? 'text-emerald-500' : 'text-amber-500'}`}>{nb.ownerRouted}/{nb.total}</span></div>
                                  <div className="text-muted-foreground">USD: <span className="font-medium">{fmt(nb.ownerUsd)}</span></div>
                                  <div className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-muted-foreground">Confirmed: {nb.confirmed}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    <span className="text-muted-foreground">Pending: {nb.pending}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                    <span className="text-muted-foreground">Failed: {nb.failed}</span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    {nb.anomalies > 0 ? (
                                      <span className="text-red-500">Anomalies: {nb.anomalies}</span>
                                    ) : (
                                      <span className="text-emerald-500">No anomalies</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  <code className="flex-1 truncate text-[10px] text-muted-foreground font-mono">
                                    {ownerWallet.slice(0, 10)}...{ownerWallet.slice(-8)}
                                  </code>
                                  <button
                                    onClick={() => handleCopyWallet(ownerWallet, network)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {copiedWallet === network ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                  </button>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        )
                      })}
                    </div>
                  ) : null}

                  <Separator />

                  {/* C. Transactions Table */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium">All Settlements ({cryptoSettlements.length})</h4>
                      {anomalousSettlements.length > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {anomalousSettlements.length} routing anomaly{anomalousSettlements.length !== 1 ? 'ies' : 'y'} detected
                        </Badge>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto rounded-lg border ops-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Network</TableHead>
                            <TableHead className="text-xs">Token + Amount</TableHead>
                            <TableHead className="text-xs text-right">USD Value</TableHead>
                            <TableHead className="text-xs text-right">Gas</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Routing</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cryptoQuery.isLoading ? (
                            Array.from({ length: 6 }).map((_, i) => (
                              <TableRow key={i}>
                                {Array.from({ length: 7 }).map((_, j) => (
                                  <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                                ))}
                              </TableRow>
                            ))
                          ) : cryptoSettlements.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No crypto settlements found</TableCell>
                            </TableRow>
                          ) : (
                            cryptoSettlements.map(s => {
                              const usd = cryptoToUsd(s.token, s.amount)
                              const networkColor = NETWORK_COLORS[s.network]
                              const isAnomaly = s._verification?.anomaly
                              return (
                                <TableRow key={s.id} className={isAnomaly ? 'bg-red-500/[0.03]' : ''}>
                                  <TableCell className="text-xs">
                                    <span className="mr-1">{TX_TYPE_ICONS[s.type] || '?'}</span>
                                    <span className="capitalize text-muted-foreground">{s.type.replace('_', ' ')}</span>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: networkColor + '60', color: networkColor }}>
                                      <span className="mr-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: networkColor }} />
                                      {NETWORK_LABELS[s.network] || s.network}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`h-2.5 w-2.5 rounded-full ${TOKEN_COLORS[s.token] || 'bg-gray-400'}`} />
                                      <span className="font-mono font-medium">{s.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                      <span className="text-muted-foreground">{s.token}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs text-right font-mono">{fmt(usd)}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{s.gasUsed > 0 ? s.gasUsed.toLocaleString() : '—'}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={`text-[10px] ${
                                      s.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' :
                                      s.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25' :
                                      'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25'
                                    }`}>
                                      {s.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {isAnomaly ? (
                                      <div className="flex flex-col gap-0.5">
                                        <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25">
                                          ANOMALY
                                        </Badge>
                                        <span className="text-[9px] text-red-500/70 truncate max-w-[120px]" title={s._verification?.anomalyReason}>
                                          {s._verification?.anomalyReason}
                                        </span>
                                      </div>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25">
                                        <ShieldCheck className="mr-1 h-2.5 w-2.5" />
                                        Owner
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* D. Disclaimer */}
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground space-y-1">
                    <p><strong>Tracking Reference:</strong> This dashboard tracks settlement <em>intents</em>. Tx hashes shown are tracking references (TRK-*) used for ledger reconciliation — not on-chain transaction confirmations.</p>
                    <p><strong>Owner Verification:</strong> Owner wallets and identity (Younes Tsouli) were pre-configured from day 1. Anti-identity-theft measures are in place. Any settlement routed to a non-owner address is flagged as an anomaly.</p>
                  </div>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </motion.div>
      </div>
    </>
  )
}

// ─── Stat Card Sub-component ─────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}