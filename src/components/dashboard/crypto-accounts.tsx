'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Wallet,
  DollarSign,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Lock,
  Ban,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Coins,
  CircleAlert,
  CircleCheck,
  CircleX,
  Key,
  Star,
  Loader2,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CryptoAccount {
  id: string
  label: string
  exchange: string
  accountType: string
  address: string
  network: string
  ownerName: string
  ownerEmail: string
  status: string
  isPrimary: boolean
  lastActivityAt: string | null
  lastBalanceCheck: string | null
  balanceUsd: number | null
  totalReceivedUsd: number
  totalSentUsd: number
  riskLevel: string
  riskReason: string | null
  notes: string
  _txCount: number
  _lastTxDate: string | null
  _linkedBatchCount: number
}

interface SummaryByExchange {
  exchange: string
  count: number
  balance: number
}

interface SummaryByRisk {
  level: string
  count: number
}

interface CryptoAccountsSummary {
  totalBalanceUsd: number
  totalReceivedUsd: number
  totalSentUsd: number
  accountCount: number
  activeCount: number
  suspendedCount: number
  staleCount: number
  byExchange: SummaryByExchange[]
  byRiskLevel: SummaryByRisk[]
}

interface CryptoAccountsResponse {
  accounts: CryptoAccount[]
  summary: CryptoAccountsSummary
  staleAccounts: CryptoAccount[]
  suspendedAccounts: CryptoAccount[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EXCHANGE_COLORS: Record<string, string> = {
  binance: 'bg-amber-100 text-amber-800 border-amber-200',
  coinbase: 'bg-sky-100 text-sky-800 border-sky-200',
  kraken: 'bg-purple-100 text-purple-800 border-purple-200',
  metamask: 'bg-orange-100 text-orange-800 border-orange-200',
  okx: 'bg-gray-100 text-gray-800 border-gray-200',
  trust_wallet: 'bg-blue-100 text-blue-800 border-blue-200',
}

const EXCHANGE_DOT_COLORS: Record<string, string> = {
  binance: 'bg-amber-500',
  coinbase: 'bg-sky-500',
  kraken: 'bg-purple-500',
  metamask: 'bg-orange-500',
  okx: 'bg-gray-500',
  trust_wallet: 'bg-blue-500',
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const RISK_DOT_COLORS: Record<string, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  suspended: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25',
}

const BAR_COLORS: Record<string, string> = {
  binance: 'bg-amber-500',
  coinbase: 'bg-sky-500',
  kraken: 'bg-purple-500',
  metamask: 'bg-orange-500',
  okx: 'bg-gray-500',
  trust_wallet: 'bg-blue-500',
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtN = (n: number) => new Intl.NumberFormat('en-US').format(n)

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: 'easeOut' as const },
}

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.06 } },
}

const scrollbarStyles = `
  .crypto-scroll::-webkit-scrollbar { width: 6px; }
  .crypto-scroll::-webkit-scrollbar-track { background: transparent; }
  .crypto-scroll::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
  .crypto-scroll::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground)); }
`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStale(lastActivityAt: string | null, days = 14): boolean {
  if (!lastActivityAt) return true
  const diff = Date.now() - new Date(lastActivityAt).getTime()
  return diff > days * 24 * 60 * 60 * 1000
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return 'Unknown'
  }
}

function getDaysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CryptoAccounts() {
  const queryClient = useQueryClient()

  // ── Query ──────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery<CryptoAccountsResponse>({
    queryKey: ['crypto-accounts'],
    queryFn: () => fetch('/api/crypto-accounts').then(r => r.json()),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const acknowledgeMutation = useMutation({
    mutationFn: (accountId: string) =>
      fetch('/api/crypto-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge_risk', accountId }),
      }).then(r => r.json()),
    onSuccess: (res: { ok?: boolean; message?: string; error?: string }) => {
      if (res?.error) {
        toast.error(res.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['crypto-accounts'] })
      toast.success(res?.message || 'Risk acknowledged successfully')
    },
    onError: () => toast.error('Failed to acknowledge risk'),
  })

  const updateStatusMutation = useMutation({
    mutationFn: (accountId: string) =>
      fetch('/api/crypto-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_status', accountId }),
      }).then(r => r.json()),
    onSuccess: (res: { ok?: boolean; message?: string; error?: string }) => {
      if (res?.error) {
        toast.error(res.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['crypto-accounts'] })
      toast.success(res?.message || 'Status updated successfully')
    },
    onError: () => toast.error('Failed to update account status'),
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const accounts = data?.accounts || []
  const summary = data?.summary
  // Filter out owner-acknowledged low-risk accounts from stale alerts
  const allStaleAccounts = data?.staleAccounts || []
  const staleAccounts = allStaleAccounts.filter(
    a => !(a.riskLevel === 'low' && a.notes?.toLowerCase().includes('acknowledged'))
  )
  const staleCount = staleAccounts.length
  const suspendedAccounts = data?.suspendedAccounts || []

  const maxExchangeBalance = Math.max(...(summary?.byExchange.map(e => e.balance) || [1]), 1)

  // ─── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{scrollbarStyles}</style>
      <div className="space-y-6">

        {/* ── 1. Summary Cards ───────────────────────────────────────────────── */}
        <motion.div {...fadeIn}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Crypto Balance */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Total Crypto Balance</p>
                    {isLoading ? (
                      <Skeleton className="mt-1 h-6 w-24" />
                    ) : (
                      <p className="truncate text-lg font-bold">{fmt(summary?.totalBalanceUsd ?? 0)}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDownLeft className="h-3 w-3 text-emerald-500" />
                  <span>Rcvd: {fmt(summary?.totalReceivedUsd ?? 0)}</span>
                  <span className="mx-1">·</span>
                  <ArrowUpRight className="h-3 w-3 text-orange-500" />
                  <span>Sent: {fmt(summary?.totalSentUsd ?? 0)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Active Accounts */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
                    <Wallet className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Active Accounts</p>
                    {isLoading ? (
                      <Skeleton className="mt-1 h-6 w-12" />
                    ) : (
                      <p className="text-lg font-bold">{summary?.activeCount ?? 0} <span className="text-sm font-normal text-muted-foreground">/ {summary?.accountCount ?? 0}</span></p>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <Progress value={summary ? ((summary.activeCount / Math.max(summary.accountCount, 1)) * 100) : 0} className="h-1.5" />
                </div>
              </CardContent>
            </Card>

            {/* Stale Accounts */}
            <Card className="border-amber-500/25 bg-amber-500/[0.02]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                    <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Stale Accounts</p>
                    {isLoading ? (
                      <Skeleton className="mt-1 h-6 w-12" />
                    ) : (
                      <p className={`text-lg font-bold ${staleCount > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                        {staleCount}
                      </p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">No activity for &gt;14 days</p>
              </CardContent>
            </Card>

            {/* Suspended / Locked */}
            <Card className="border-red-500/25 bg-red-500/[0.02]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                    <Lock className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Suspended / Locked</p>
                    {isLoading ? (
                      <Skeleton className="mt-1 h-6 w-12" />
                    ) : (
                      <p className={`text-lg font-bold ${(summary?.suspendedCount ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {summary?.suspendedCount ?? 0}
                      </p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Accounts with restricted access</p>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* ── 2. Crypto Accounts Used — Account Cards Grid ──────────────────── */}
        <motion.div {...fadeIn}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Crypto Accounts Used</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">All owner crypto accounts with diagnostic visibility</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['crypto-accounts'] })}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {isLoading ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-14" />
                    </div>
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-4 w-36" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : isError ? (
            <Card className="mt-4">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
                <CircleX className="h-8 w-8 text-red-400" />
                <p className="text-sm text-muted-foreground">Failed to load crypto accounts</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['crypto-accounts'] })}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : accounts.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
                <Wallet className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No crypto accounts found</p>
              </CardContent>
            </Card>
          ) : (
            <motion.div
              className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              {accounts.map((account, idx) => {
                const daysSince = getDaysSince(account.lastActivityAt)
                const stale = isStale(account.lastActivityAt)
                const suspended = account.status === 'suspended'
                const exchangeColor = EXCHANGE_COLORS[account.exchange] || 'bg-gray-100 text-gray-800 border-gray-200'
                const exchangeDot = EXCHANGE_DOT_COLORS[account.exchange] || 'bg-gray-500'
                const statusColor = STATUS_COLORS[account.status] || STATUS_COLORS.active
                const riskColor = RISK_COLORS[account.riskLevel] || RISK_COLORS.low
                const riskDot = RISK_DOT_COLORS[account.riskLevel] || RISK_DOT_COLORS.low

                return (
                  <motion.div key={account.id} variants={fadeIn} transition={{ delay: idx * 0.06 }}>
                    <Card className={`relative overflow-hidden transition-shadow hover:shadow-md ${stale && !suspended ? 'border-amber-500/20' : ''} ${suspended ? 'border-red-500/20 opacity-90' : ''}`}>
                      {/* Stale warning stripe */}
                      {stale && !suspended && (
                        <div className="absolute right-0 top-0 h-1 w-24 bg-gradient-to-l from-amber-500 to-transparent" />
                      )}
                      {suspended && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/30 backdrop-blur-[1px]">
                          <Ban className="h-12 w-12 text-red-500/30" />
                        </div>
                      )}

                      <CardContent className="p-4">
                        {/* Header: Exchange badge + Status + Primary */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${exchangeColor}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${exchangeDot}`} />
                              {account.exchange}
                            </div>
                            {account.isPrimary && (
                              <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0">
                                <Star className="h-2.5 w-2.5" />
                                Primary
                              </Badge>
                            )}
                          </div>
                          <Badge variant="outline" className={`shrink-0 text-[10px] ${statusColor}`}>
                            {account.status === 'active' ? <CircleCheck className="mr-0.5 h-2.5 w-2.5" /> : <CircleX className="mr-0.5 h-2.5 w-2.5" />}
                            {account.status}
                          </Badge>
                        </div>

                        {/* Account Label */}
                        <h4 className="mt-2 text-sm font-semibold truncate">{account.label}</h4>

                        {/* Risk Level */}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${riskDot}`} />
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${riskColor}`}>
                            {account.riskLevel} risk
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {account.accountType}
                          </span>
                        </div>

                        <Separator className="my-3" />

                        {/* Financials */}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Balance</p>
                            <p className="text-sm font-semibold">
                              {account.balanceUsd !== null ? fmt(account.balanceUsd) : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Received</p>
                            <div className="flex items-center gap-0.5">
                              <ArrowDownLeft className="h-3 w-3 text-emerald-500" />
                              <p className="text-xs">{fmt(account.totalReceivedUsd)}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sent</p>
                            <div className="flex items-center gap-0.5">
                              <ArrowUpRight className="h-3 w-3 text-orange-500" />
                              <p className="text-xs">{fmt(account.totalSentUsd)}</p>
                            </div>
                          </div>
                        </div>

                        <Separator className="my-3" />

                        {/* Details */}
                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          {/* Network */}
                          <div className="flex items-center gap-2">
                            <Activity className="h-3 w-3 shrink-0" />
                            <span className="truncate">{account.network}</span>
                          </div>

                          {/* Owner */}
                          <div className="flex items-center gap-2">
                            <Key className="h-3 w-3 shrink-0" />
                            <span className="truncate">{account.ownerName} &lt;{account.ownerEmail}&gt;</span>
                          </div>

                          {/* Last Activity */}
                          <div className="flex items-center gap-2">
                            <Clock className={`h-3 w-3 shrink-0 ${stale ? 'text-amber-500' : ''}`} />
                            <span className={stale ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
                              Last activity: {relativeTime(account.lastActivityAt)}
                            </span>
                            {stale && daysSince !== null && (
                              <Badge variant="outline" className="ml-auto shrink-0 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400 px-1.5 py-0">
                                <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                                {daysSince}d stale
                              </Badge>
                            )}
                          </div>

                          {/* Tx count + Batches */}
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Coins className="h-3 w-3 shrink-0" />
                              {fmtN(account._txCount)} txns
                            </span>
                            <span className="flex items-center gap-1">
                              <Activity className="h-3 w-3 shrink-0" />
                              {account._linkedBatchCount} batches
                            </span>
                          </div>

                          {/* Address */}
                          {account.address && (
                            <div className="flex items-center gap-2">
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="font-mono text-[10px] truncate">
                                {account.address.length > 20
                                  ? `${account.address.slice(0, 8)}...${account.address.slice(-8)}`
                                  : account.address}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Risk Reason Alert */}
                        {account.riskReason && (
                          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                            <p className="text-[11px] leading-relaxed text-red-600 dark:text-red-400">{account.riskReason}</p>
                          </div>
                        )}

                        {/* Notes */}
                        {account.notes && (
                          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground italic">{account.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </motion.div>

        {/* ── 3. Stale Account Alert Panel ───────────────────────────────────── */}
        {staleAccounts.length > 0 && (
          <motion.div {...fadeIn}>
            <Card className="border-amber-500/30 bg-amber-500/[0.02]">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                    <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">Stale Account Alert</CardTitle>
                    <p className="text-xs text-muted-foreground">{staleAccounts.length} account(s) with no activity for &gt;14 days</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {staleAccounts.map(account => {
                  const daysSince = getDaysSince(account.lastActivityAt)
                  return (
                    <div key={account.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge className={EXCHANGE_COLORS[account.exchange] || ''}>{account.exchange}</Badge>
                            {account.isPrimary && (
                              <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0">
                                <Star className="h-2.5 w-2.5" />
                                Primary
                              </Badge>
                            )}
                            <span className="text-sm font-semibold">{account.label}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                              No activity for {daysSince !== null ? `${daysSince} days` : 'an extended period'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground max-w-lg">
                            Account dormancy may trigger exchange compliance review or fund freeze.
                            {account.balanceUsd !== null && account.balanceUsd > 0
                              ? ` ${fmt(account.balanceUsd)} is currently held in this account.`
                              : ''}
                          </p>
                          {account._linkedBatchCount > 0 && (
                            <p className="text-xs text-muted-foreground">
                              <Coins className="mr-1 inline h-3 w-3" />
                              Linked to {account._linkedBatchCount} payout batch{account._linkedBatchCount > 1 ? 'es' : ''} — review recommended
                            </p>
                          )}
                          {account._lastTxDate && (
                            <p className="text-[11px] text-muted-foreground">
                              Last transaction: {format(new Date(account._lastTxDate), 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 border-amber-500/30 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                          onClick={() => acknowledgeMutation.mutate(account.id)}
                          disabled={acknowledgeMutation.isPending}
                        >
                          {acknowledgeMutation.isPending ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Acknowledge Risk
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── 4. Suspended Account Alert Panel ───────────────────────────────── */}
        {suspendedAccounts.length > 0 && (
          <motion.div {...fadeIn}>
            <Card className="border-red-500/30 bg-red-500/[0.02]">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
                    <Ban className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">Suspended Account Alert</CardTitle>
                    <p className="text-xs text-muted-foreground">{suspendedAccounts.length} account(s) suspended or locked</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {suspendedAccounts.map(account => (
                  <div key={account.id} className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge className={EXCHANGE_COLORS[account.exchange] || ''}>{account.exchange}</Badge>
                          <Badge variant="outline" className={STATUS_COLORS.suspended}>
                            <Lock className="mr-0.5 h-2.5 w-2.5" />
                            {account.status}
                          </Badge>
                          <span className="text-sm font-semibold">{account.label}</span>
                        </div>

                        {/* Locked Funds */}
                        {account.balanceUsd !== null && account.balanceUsd > 0 && (
                          <div className="flex items-center gap-2 text-sm">
                            <Lock className="h-4 w-4 text-red-500" />
                            <span className="font-semibold text-red-600 dark:text-red-400">
                              {fmt(account.balanceUsd)} locked
                            </span>
                          </div>
                        )}

                        {/* Risk Reason */}
                        {account.riskReason && (
                          <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
                            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                            <p className="text-xs font-medium text-red-600 dark:text-red-400">{account.riskReason}</p>
                          </div>
                        )}

                        {/* Owner + Address */}
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Owner: {account.ownerName} &lt;{account.ownerEmail}&gt;</p>
                          {account.address && (
                            <p className="font-mono text-[10px]">
                              {account.address.length > 30
                                ? `${account.address.slice(0, 12)}...${account.address.slice(-12)}`
                                : account.address}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-red-500/30 bg-red-500/5 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        onClick={() => updateStatusMutation.mutate(account.id)}
                        disabled={updateStatusMutation.isPending}
                      >
                        {updateStatusMutation.isPending ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Update Status
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── 5. Exchange Distribution ───────────────────────────────────────── */}
        {summary?.byExchange && summary.byExchange.length > 0 && (
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">Exchange Distribution</CardTitle>
                    <p className="text-xs text-muted-foreground">Balance distribution across exchanges</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.byExchange.map(exchange => {
                  const pct = maxExchangeBalance > 0 ? (exchange.balance / maxExchangeBalance) * 100 : 0
                  const barColor = BAR_COLORS[exchange.exchange] || 'bg-gray-500'
                  const badgeColor = EXCHANGE_COLORS[exchange.exchange] || 'bg-gray-100 text-gray-800 border-gray-200'

                  return (
                    <div key={exchange.exchange} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Badge className={`text-[10px] px-1.5 py-0 ${badgeColor}`}>
                            {exchange.exchange}
                          </Badge>
                          <span className="text-muted-foreground">
                            {exchange.count} account{exchange.count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <span className="font-semibold">{fmt(exchange.balance)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
                        <motion.div
                          className={`h-full rounded-full ${barColor}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                        />
                      </div>
                    </div>
                  )
                })}

                {/* Total */}
                <Separator />
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Total</span>
                  <span className="font-bold">{fmt(summary.totalBalanceUsd)}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>
    </>
  )
}