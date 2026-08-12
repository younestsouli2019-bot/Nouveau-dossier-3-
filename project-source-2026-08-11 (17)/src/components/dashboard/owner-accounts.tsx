'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Banknote, Wallet, Mail, Globe, Building2, Star, Plus, Edit, Trash2,
  Copy, Check, ArrowUpRight, ArrowDownLeft, Clock, AlertCircle,
  CircleDot, ShieldCheck, XCircle, RefreshCw, Search,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OwnerAccount {
  id: string
  label: string
  accountType: string
  isActive: boolean
  isPrimary: boolean
  sortOrder: number
  purposes: string
  accountHolder: string | null
  accountNumber: string | null
  accountNumberLast: string | null
  bankName: string | null
  bankCode: string | null
  branchCode: string | null
  swiftCode: string | null
  routingNumber: string | null
  countryCode: string | null
  currency: string
  network: string | null
  walletAddress: string | null
  walletAddressShort: string | null
  preferredToken: string | null
  chainId: number | null
  explorerUrl: string | null
  paypalEmail: string | null
  paypalType: string | null
  paypalCountry: string | null
  wiseEmail: string | null
  wiseCurrency: string | null
  payoneerId: string | null
  notes: string | null
  verifiedAt: string | null
  lastUsedAt: string | null
  totalReceived: number
  totalSent: number
  txCount: number
  ownerPaymentConfigId: string | null
  _settlementCount: number
  createdAt: string
  updatedAt: string
}

interface OwnerSettlement {
  id: string
  ownerAccountId: string
  ownerAccount: {
    id: string; label: string; accountType: string; currency: string
    walletAddressShort: string | null; accountNumberLast: string | null
    bankName: string | null; paypalEmail: string | null; wiseEmail: string | null
  }
  referenceId: string | null
  amount: number
  currency: string
  status: string
  direction: string
  purpose: string
  description: string | null
  sourceLabel: string | null
  destinationLabel: string | null
  fee: number
  netAmount: number | null
  exchangeRate: number | null
  settledAt: string | null
  createdAt: string
  updatedAt: string
}

interface AccountSummary {
  total: number
  byType: Record<string, number>
  activeCount: number
  totalReceived: number
  totalSent: number
}

interface SettlementSummary {
  total: number
  totalAmount: number
  byStatus: Record<string, number>
  byPurpose: Record<string, number>
  byAccountType: Record<string, number>
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SETTLEMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  reversed: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank_wire: 'Bank Wire',
  l2_crypto: 'L2 Crypto',
  paypal: 'PayPal',
  wise: 'Wise',
  payoneer: 'Payoneer',
  internal_pool: 'Internal Pool',
}

const PURPOSE_LABELS: Record<string, string> = {
  salary: 'Salary',
  settlements: 'Settlements',
  reconciliation: 'Reconciliation',
  general: 'General',
  crypto_settlement: 'Crypto Settlement',
  vendor_payments: 'Vendor Payments',
}

const NETWORK_OPTIONS = [
  { value: 'arbitrum', label: 'Arbitrum', emoji: '🟣', chainId: 42161 },
  { value: 'optimism', label: 'Optimism', emoji: '🔴', chainId: 10 },
  { value: 'base', label: 'Base', emoji: '🔵', chainId: 8453 },
  { value: 'polygon', label: 'Polygon', emoji: '🟣', chainId: 137 },
  { value: 'linea', label: 'Linea', emoji: '🔵', chainId: 59144 },
]

const COUNTRY_FLAGS: Record<string, string> = {
  MA: '🇲🇦', US: '🇺🇸', FR: '🇫🇷', GB: '🇬🇧', DE: '🇩🇪', AE: '🇦🇪',
  CA: '🇨🇦', TR: '🇹🇷', SA: '🇸🇦', EG: '🇪🇬', ES: '🇪🇸', IT: '🇮🇹',
}

const ALL_PURPOSES = ['salary', 'settlements', 'reconciliation', 'general', 'crypto_settlement', 'vendor_payments']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(n: number, currency?: string) {
  const c = currency === 'MAD' ? 'MAD' : 'USD'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n)
}

function fmt(n: number) {
  return fmtCurrency(n)
}

function getAccountTypeIcon(type: string) {
  switch (type) {
    case 'bank_wire': return <Banknote className="w-4 h-4" />
    case 'l2_crypto': return <Wallet className="w-4 h-4" />
    case 'paypal': return <Mail className="w-4 h-4" />
    case 'wise': return <Globe className="w-4 h-4" />
    case 'payoneer': return <Building2 className="w-4 h-4" />
    default: return <CircleDot className="w-4 h-4" />
  }
}

function getAccountTypeBorder(type: string, isPrimary: boolean) {
  if (type === 'bank_wire') return isPrimary ? 'border-l-4 border-l-orange-500' : 'border-l-4 border-l-gray-400 dark:border-l-gray-500'
  if (type === 'l2_crypto') return 'border-l-4 border-l-violet-500'
  if (type === 'paypal') return 'border-l-4 border-l-blue-500'
  if (type === 'wise') return 'border-l-4 border-l-emerald-500'
  if (type === 'payoneer') return 'border-l-4 border-l-amber-500'
  return 'border-l-4 border-l-gray-400 dark:border-l-gray-500'
}

function getNetworkBadge(network: string | null) {
  if (!network) return null
  const found = NETWORK_OPTIONS.find(n => n.value === network)
  return found ? `${found.emoji} ${found.label}` : network
}

function getNetworkColor(network: string | null) {
  if (!network) return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  const found = NETWORK_OPTIONS.find(n => n.value === network)
  if (!found) return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  switch (network) {
    case 'arbitrum': case 'polygon': return 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300'
    case 'optimism': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    case 'base': case 'linea': return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

// ─── Copy Button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

// ─── Skeletons ───────────────────────────────────────────────────────────────

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <Skeleton className="h-3 w-24" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <Skeleton className="h-7 w-20 mb-1" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  )
}

function AccountCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-12" />
      </div>
      <Skeleton className="h-4 w-40 mb-2" />
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-4 w-32" />
    </Card>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface OwnerAccountsTabProps {
  initialAccounts?: OwnerAccount[]
  initialSummary?: AccountSummary
}

export default function OwnerAccountsTab({ initialAccounts, initialSummary }: OwnerAccountsTabProps) {
  // Data state
  const [accounts, setAccounts] = useState<OwnerAccount[]>(initialAccounts || [])
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(initialSummary || null)
  const [settlements, setSettlements] = useState<OwnerSettlement[]>([])
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary | null>(null)
  const [loading, setLoading] = useState(!initialAccounts)

  // Filter state
  const [accountTypeFilter, setAccountTypeFilter] = useState('all')
  const [purposeFilter, setPurposeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [settlementAccountFilter, setSettlementAccountFilter] = useState('all')
  const [settlementStatusFilter, setSettlementStatusFilter] = useState('all')
  const [settlementPurposeFilter, setSettlementPurposeFilter] = useState('all')
  const [settlementDirectionFilter, setSettlementDirectionFilter] = useState('all')

  // Sub-tab state
  const [subTab, setSubTab] = useState<'accounts' | 'settlements'>('accounts')

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [formType, setFormType] = useState('bank_wire')
  const [formLabel, setFormLabel] = useState('')
  const [formPurposes, setFormPurposes] = useState<string[]>([])
  const [formCurrency, setFormCurrency] = useState('USD')
  const [formIsPrimary, setFormIsPrimary] = useState(false)
  // Bank wire
  const [formAccountHolder, setFormAccountHolder] = useState('')
  const [formAccountNumber, setFormAccountNumber] = useState('')
  const [formBankName, setFormBankName] = useState('')
  const [formSwiftCode, setFormSwiftCode] = useState('')
  const [formCountryCode, setFormCountryCode] = useState('')
  // L2 crypto
  const [formNetwork, setFormNetwork] = useState('arbitrum')
  const [formWalletAddress, setFormWalletAddress] = useState('')
  const [formPreferredToken, setFormPreferredToken] = useState('')
  // PayPal
  const [formPaypalEmail, setFormPaypalEmail] = useState('')
  const [formPaypalType, setFormPaypalType] = useState('business')
  // Wise
  const [formWiseEmail, setFormWiseEmail] = useState('')
  const [formWiseCurrency, setFormWiseCurrency] = useState('USD')

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (accountTypeFilter !== 'all') params.set('accountType', accountTypeFilter)
      if (statusFilter === 'active') params.set('isActive', 'true')
      if (statusFilter === 'inactive') params.set('isActive', 'false')
      if (purposeFilter !== 'all') params.set('purpose', purposeFilter)

      const accRes = await fetch(`/api/owner-accounts?${params.toString()}`)
      if (accRes.ok) {
        const accData = await accRes.json()
        if (accData.success) {
          setAccounts(accData.data)
          setAccountSummary(accData.summary)
        }
      }
    } catch (err) {
      console.error('Failed to fetch owner accounts:', err)
      toast.error('Failed to load accounts data')
    } finally {
      setLoading(false)
    }
  }, [accountTypeFilter, statusFilter, purposeFilter])

  // Fetch settlements (lazy, only when settlements tab is viewed)
  const [settlementsLoaded, setSettlementsLoaded] = useState(false)
  const fetchSettlements = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (settlementAccountFilter !== 'all') params.set('ownerAccountId', settlementAccountFilter)
      if (settlementStatusFilter !== 'all') params.set('status', settlementStatusFilter)
      if (settlementPurposeFilter !== 'all') params.set('purpose', settlementPurposeFilter)
      if (settlementDirectionFilter !== 'all') params.set('direction', settlementDirectionFilter)

      const setRes = await fetch(`/api/owner-accounts/settlements?${params.toString()}`)
      if (setRes.ok) {
        const setData = await setRes.json()
        if (setData.success) {
          setSettlements(setData.data)
          setSettlementSummary(setData.summary)
          setSettlementsLoaded(true)
        }
      }
    } catch (err) {
      console.error('Failed to fetch settlements:', err)
      toast.error('Failed to load settlements')
    }
  }, [settlementAccountFilter, settlementStatusFilter, settlementPurposeFilter, settlementDirectionFilter])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])
  useEffect(() => { if (subTab === 'settlements' && !settlementsLoaded) fetchSettlements() }, [subTab, settlementsLoaded, fetchSettlements])

  // Reset form
  const resetForm = useCallback(() => {
    setFormType('bank_wire')
    setFormLabel('')
    setFormPurposes([])
    setFormCurrency('USD')
    setFormIsPrimary(false)
    setFormAccountHolder('')
    setFormAccountNumber('')
    setFormBankName('')
    setFormSwiftCode('')
    setFormCountryCode('')
    setFormNetwork('arbitrum')
    setFormWalletAddress('')
    setFormPreferredToken('')
    setFormPaypalEmail('')
    setFormPaypalType('business')
    setFormWiseEmail('')
    setFormWiseCurrency('USD')
  }, [])

  // Handle create account
  const handleCreate = async () => {
    if (!formLabel.trim()) {
      toast.error('Label is required')
      return
    }
    try {
      setAddLoading(true)
      const body: Record<string, unknown> = {
        label: formLabel.trim(),
        accountType: formType,
        purposes: formPurposes.join(','),
        currency: formCurrency,
        isPrimary: formIsPrimary,
      }
      if (formType === 'bank_wire') {
        body.accountHolder = formAccountHolder.trim() || null
        body.accountNumber = formAccountNumber.trim() || null
        body.bankName = formBankName.trim() || null
        body.swiftCode = formSwiftCode.trim() || null
        body.countryCode = formCountryCode.trim() || null
      } else if (formType === 'l2_crypto') {
        body.network = formNetwork
        body.walletAddress = formWalletAddress.trim() || null
        body.preferredToken = formPreferredToken.trim() || null
      } else if (formType === 'paypal') {
        body.paypalEmail = formPaypalEmail.trim() || null
        body.paypalType = formPaypalType
      } else if (formType === 'wise') {
        body.wiseEmail = formWiseEmail.trim() || null
        body.wiseCurrency = formWiseCurrency
      }

      const res = await fetch('/api/owner-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Account created successfully')
        setAddDialogOpen(false)
        resetForm()
        fetchAccounts()
      } else {
        toast.error(data.error || 'Failed to create account')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setAddLoading(false)
    }
  }

  // Handle delete
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/owner-accounts/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        toast.success('Account deleted')
        fetchAccounts()
      } else {
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Network error')
    }
  }

  // Toggle purpose checkbox
  const togglePurpose = useCallback((purpose: string) => {
    setFormPurposes(prev =>
      prev.includes(purpose) ? prev.filter(p => p !== purpose) : [...prev, purpose]
    )
  }, [])

  // Filtered settlements
  const filteredSettlements = useMemo(() => {
    return settlements.filter(s => {
      if (settlementAccountFilter !== 'all' && s.ownerAccountId !== settlementAccountFilter) return false
      if (settlementStatusFilter !== 'all' && s.status !== settlementStatusFilter) return false
      if (settlementPurposeFilter !== 'all' && s.purpose !== settlementPurposeFilter) return false
      if (settlementDirectionFilter !== 'all' && s.direction !== settlementDirectionFilter) return false
      return true
    })
  }, [settlements, settlementAccountFilter, settlementStatusFilter, settlementPurposeFilter, settlementDirectionFilter])

  // Pending settlements count and amount
  const pendingSettlements = useMemo(() => {
    return settlements.filter(s => s.status === 'pending' || s.status === 'processing')
  }, [settlements])
  const pendingAmount = pendingSettlements.reduce((sum, s) => sum + s.amount, 0)

  // ─── Render: Summary Cards ────────────────────────────────────────────────
  const renderSummaryCards = () => {
    if (loading) {
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SummaryCardSkeleton key={i} />)}
        </div>
      )
    }
    const s = accountSummary
    if (!s) return null
    const typeEntries = Object.entries(s.byType || {})
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">Total Accounts</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold">{s.total}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{s.activeCount} active</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">Total Received</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-emerald-600">{fmt(s.totalReceived)}</p>
              <p className="text-xs text-muted-foreground">across all accounts</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">Total Sent</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-orange-600">{fmt(s.totalSent)}</p>
              <p className="text-xs text-muted-foreground">across all accounts</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="border-amber-200 dark:border-amber-800 hover:shadow-md transition-shadow">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs text-amber-600 dark:text-amber-400">Pending Settlements</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-amber-600">{pendingSettlements.length}</p>
              <p className="text-xs text-muted-foreground">{fmt(pendingAmount)}</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">By Type</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-1">
                {typeEntries.length > 0 ? typeEntries.map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-[10px] gap-1">
                    {getAccountTypeIcon(type)}
                    {ACCOUNT_TYPE_LABELS[type] || type} ({count})
                  </Badge>
                )) : <span className="text-xs text-muted-foreground">No accounts yet</span>}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  // ─── Render: Account Card ─────────────────────────────────────────────────
  const renderAccountCard = (account: OwnerAccount, index: number) => {
    const borderClass = getAccountTypeBorder(account.accountType, account.isPrimary)
    const purposes = account.purposes ? account.purposes.split(',').filter(Boolean) : []
    const lastUsed = account.lastUsedAt ? format(new Date(account.lastUsedAt), 'MMM d, yyyy') : 'Never'

    return (
      <motion.div
        key={account.id}
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04 }}
        whileHover={{ scale: 1.01 }}
      >
        <Card className={`${borderClass} hover:shadow-md transition-all duration-200`}>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 mt-0.5 text-muted-foreground">
                  {getAccountTypeIcon(account.accountType)}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {account.label}
                    {account.isPrimary && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                  </CardTitle>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {ACCOUNT_TYPE_LABELS[account.accountType] || account.accountType}
                    </Badge>
                    <Badge className={`text-[10px] px-1.5 py-0 ${account.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {account.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Account</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete &quot;{account.label}&quot;? This action can be recovered.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(account.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-4 pb-4 space-y-3">
            {/* Type-specific content */}
            {account.accountType === 'bank_wire' && (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {account.bankName && (
                  <p className="text-sm font-medium text-foreground">
                    {COUNTRY_FLAGS[account.countryCode || ''] || ''} {account.bankName}
                  </p>
                )}
                {account.accountHolder && <p>Holder: {account.accountHolder}</p>}
                {account.accountNumberLast && (
                  <p className="flex items-center gap-1">
                    RIB: ····{account.accountNumberLast}
                    {account.accountNumber && <CopyButton text={account.accountNumber} />}
                  </p>
                )}
                {account.swiftCode && <p>SWIFT: {account.swiftCode}</p>}
                <Badge variant="outline" className="text-[10px] font-mono">{account.currency}</Badge>
              </div>
            )}

            {account.accountType === 'l2_crypto' && (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${getNetworkColor(account.network)}`}>
                    {getNetworkBadge(account.network)}
                  </Badge>
                  {account.chainId && <span className="text-[10px] font-mono">Chain #{account.chainId}</span>}
                </div>
                {account.walletAddressShort && (
                  <p className="flex items-center gap-1 font-mono text-sm text-foreground">
                    {account.walletAddressShort}
                    {account.walletAddress && <CopyButton text={account.walletAddress} />}
                  </p>
                )}
                {account.preferredToken && (
                  <Badge variant="outline" className="text-[10px]">Token: {account.preferredToken}</Badge>
                )}
                <Badge variant="outline" className="text-[10px] font-mono">{account.currency}</Badge>
              </div>
            )}

            {account.accountType === 'paypal' && (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1 text-sm text-foreground">
                  <Mail className="w-3.5 h-3.5" />
                  {account.paypalEmail}
                </p>
                {account.paypalType && (
                  <Badge variant="outline" className="text-[10px]">
                    {account.paypalType === 'business' ? '🏢 Business' : '👤 Personal'}
                  </Badge>
                )}
                {account.paypalCountry && (
                  <p>{COUNTRY_FLAGS[account.paypalCountry] || ''} {account.paypalCountry}</p>
                )}
              </div>
            )}

            {account.accountType === 'wise' && (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1 text-sm text-foreground">
                  <Globe className="w-3.5 h-3.5" />
                  {account.wiseEmail}
                </p>
                {account.wiseCurrency && (
                  <Badge variant="outline" className="text-[10px] font-mono">{account.wiseCurrency}</Badge>
                )}
              </div>
            )}

            {account.accountType === 'payoneer' && (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1 text-sm text-foreground">
                  <Building2 className="w-3.5 h-3.5" />
                  {account.payoneerId || 'Payoneer Account'}
                </p>
              </div>
            )}

            {/* Purposes */}
            {purposes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {purposes.map(p => (
                  <Badge key={p} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {PURPOSE_LABELS[p] || p}
                  </Badge>
                ))}
              </div>
            )}

            <Separator />

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                  <ArrowDownLeft className="w-3 h-3" />{fmtCurrency(account.totalReceived, account.currency)}
                </span>
                <span className="text-orange-600 dark:text-orange-400 flex items-center gap-0.5">
                  <ArrowUpRight className="w-3 h-3" />{fmtCurrency(account.totalSent, account.currency)}
                </span>
              </div>
              <span className="text-muted-foreground">{account.txCount} tx</span>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{lastUsed}</span>
              <span>{account._settlementCount} settlements</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ─── Render: Settlements Table ────────────────────────────────────────────
  const renderSettlementsTable = () => {
    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={settlementAccountFilter} onValueChange={setSettlementAccountFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label} ({ACCOUNT_TYPE_LABELS[a.accountType]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={settlementStatusFilter} onValueChange={setSettlementStatusFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={settlementPurposeFilter} onValueChange={setSettlementPurposeFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="All Purposes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Purposes</SelectItem>
              <SelectItem value="salary">Salary</SelectItem>
              <SelectItem value="settlement">Settlement</SelectItem>
              <SelectItem value="reconciliation">Reconciliation</SelectItem>
              <SelectItem value="refund">Refund</SelectItem>
              <SelectItem value="vendor_payment">Vendor Payment</SelectItem>
            </SelectContent>
          </Select>

          <Select value={settlementDirectionFilter} onValueChange={setSettlementDirectionFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All Directions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Directions</SelectItem>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Destination</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs text-right">Fee</TableHead>
                  <TableHead className="text-xs text-right">Net</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Purpose</TableHead>
                  <TableHead className="text-xs">Direction</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSettlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">
                      No settlements found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSettlements.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs max-w-[140px] truncate" title={s.sourceLabel || undefined}>
                        {s.sourceLabel || '—'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={s.destinationLabel || undefined}>
                        {s.destinationLabel || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {fmtCurrency(s.amount, s.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">
                        {fmtCurrency(s.fee, s.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {s.netAmount != null ? fmtCurrency(s.netAmount, s.currency) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${SETTLEMENT_STATUS_COLORS[s.status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {PURPOSE_LABELS[s.purpose] || s.purpose}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] gap-0.5 ${s.direction === 'inbound' ? 'text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700' : 'text-orange-600 border-orange-300 dark:text-orange-400 dark:border-orange-700'}`}
                        >
                          {s.direction === 'inbound' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          {s.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(s.createdAt), 'MMM d, HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      </div>
    )
  }

  // ─── Render: Add Account Dialog ───────────────────────────────────────────
  const renderAddDialog = () => (
    <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) resetForm() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Owner Account</DialogTitle>
          <DialogDescription>Create a new pre-set account for settlements and payments.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Account Type */}
          <div className="space-y-1.5">
            <Label className="text-sm">Account Type</Label>
            <Select value={formType} onValueChange={setFormType}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_wire">🏦 Bank Wire</SelectItem>
                <SelectItem value="l2_crypto">🔗 L2 Crypto</SelectItem>
                <SelectItem value="paypal"> 💰 PayPal</SelectItem>
                <SelectItem value="wise">🌐 Wise</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Common Fields */}
          <div className="space-y-1.5">
            <Label className="text-sm">Label *</Label>
            <Input
              placeholder="e.g., Main Business Account"
              value={formLabel}
              onChange={e => setFormLabel(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Currency</Label>
            <Select value={formCurrency} onValueChange={setFormCurrency}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD - US Dollar</SelectItem>
                <SelectItem value="MAD">MAD - Moroccan Dirham</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="GBP">GBP - British Pound</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Purposes multi-select */}
          <div className="space-y-2">
            <Label className="text-sm">Purposes</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PURPOSES.map(purpose => (
                <div key={purpose} className="flex items-center gap-2">
                  <Checkbox
                    id={`purpose-${purpose}`}
                    checked={formPurposes.includes(purpose)}
                    onCheckedChange={() => togglePurpose(purpose)}
                  />
                  <Label htmlFor={`purpose-${purpose}`} className="text-xs font-normal cursor-pointer">
                    {PURPOSE_LABELS[purpose] || purpose}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Type-specific fields */}
          {formType === 'bank_wire' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bank Wire Details</p>
              <div className="space-y-1.5">
                <Label className="text-sm">Account Holder</Label>
                <Input placeholder="Full name" value={formAccountHolder} onChange={e => setFormAccountHolder(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Account Number (RIB)</Label>
                <Input placeholder="Full account number" value={formAccountNumber} onChange={e => setFormAccountNumber(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Bank Name</Label>
                <Input placeholder="e.g., Attijariwafa Bank" value={formBankName} onChange={e => setFormBankName(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">SWIFT Code</Label>
                <Input placeholder="e.g., BCMAMAMC" value={formSwiftCode} onChange={e => setFormSwiftCode(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Country Code</Label>
                <Select value={formCountryCode} onValueChange={setFormCountryCode}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MA">🇲🇦 Morocco (MA)</SelectItem>
                    <SelectItem value="US">🇺🇸 United States (US)</SelectItem>
                    <SelectItem value="FR">🇫🇷 France (FR)</SelectItem>
                    <SelectItem value="GB">🇬🇧 United Kingdom (GB)</SelectItem>
                    <SelectItem value="DE">🇩🇪 Germany (DE)</SelectItem>
                    <SelectItem value="AE">🇦🇪 UAE (AE)</SelectItem>
                    <SelectItem value="TR">🇹🇷 Turkey (TR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {formType === 'l2_crypto' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">L2 Crypto Details</p>
              <div className="space-y-1.5">
                <Label className="text-sm">Network</Label>
                <Select value={formNetwork} onValueChange={setFormNetwork}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NETWORK_OPTIONS.map(n => (
                      <SelectItem key={n.value} value={n.value}>
                        {n.emoji} {n.label} (Chain #{n.chainId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Wallet Address</Label>
                <Input placeholder="0x..." value={formWalletAddress} onChange={e => setFormWalletAddress(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Preferred Token</Label>
                <Input placeholder="e.g., USDC, USDT, ETH" value={formPreferredToken} onChange={e => setFormPreferredToken(e.target.value)} className="h-9" />
              </div>
            </div>
          )}

          {formType === 'paypal' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">PayPal Details</p>
              <div className="space-y-1.5">
                <Label className="text-sm">PayPal Email</Label>
                <Input type="email" placeholder="payments@example.com" value={formPaypalEmail} onChange={e => setFormPaypalEmail(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Type</Label>
                <Select value={formPaypalType} onValueChange={setFormPaypalType}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">🏢 Business</SelectItem>
                    <SelectItem value="personal">👤 Personal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {formType === 'wise' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Wise Details</p>
              <div className="space-y-1.5">
                <Label className="text-sm">Wise Email</Label>
                <Input type="email" placeholder="wise@example.com" value={formWiseEmail} onChange={e => setFormWiseEmail(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Receiving Currency</Label>
                <Select value={formWiseCurrency} onValueChange={setFormWiseCurrency}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="MAD">MAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Separator />

          {/* Is Primary toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Set as Primary</Label>
              <p className="text-[11px] text-muted-foreground">Mark this as the primary account for its type</p>
            </div>
            <Switch checked={formIsPrimary} onCheckedChange={setFormIsPrimary} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm() }}>Cancel</Button>
          <Button onClick={handleCreate} disabled={addLoading || !formLabel.trim()}>
            {addLoading ? 'Creating...' : 'Create Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // ─── Main Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Owner Accounts</h2>
          <p className="text-sm text-muted-foreground">Pre-settlement accounts for salary, payments, and reconciliation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => { fetchAccounts(); if (settlementsLoaded) fetchSettlements() }} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {renderAddDialog()}
        </div>
      </div>

      {/* Summary Cards */}
      {renderSummaryCards()}

      {/* Sub-tabs: Accounts / Settlements */}
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as 'accounts' | 'settlements')}>
        <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-muted/50 max-w-[300px]">
          <TabsTrigger value="accounts" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Wallet className="w-3.5 h-3.5 hidden sm:block" />Accounts
          </TabsTrigger>
          <TabsTrigger value="settlements" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <ArrowUpRight className="w-3.5 h-3.5 hidden sm:block" />Settlements
          </TabsTrigger>
        </TabsList>

        {/* ── Sub-tab: Accounts ─────────────────────────────────────────── */}
        <TabsContent value="accounts" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="bank_wire">Bank Wire</SelectItem>
                <SelectItem value="l2_crypto">L2 Crypto</SelectItem>
                <SelectItem value="paypal">PayPal</SelectItem>
                <SelectItem value="wise">Wise</SelectItem>
                <SelectItem value="payoneer">Payoneer</SelectItem>
                <SelectItem value="internal_pool">Internal Pool</SelectItem>
              </SelectContent>
            </Select>

            <Select value={purposeFilter} onValueChange={setPurposeFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All Purposes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Purposes</SelectItem>
                <SelectItem value="salary">Salary</SelectItem>
                <SelectItem value="settlements">Settlements</SelectItem>
                <SelectItem value="reconciliation">Reconciliation</SelectItem>
                <SelectItem value="crypto_settlement">Crypto Settlement</SelectItem>
                <SelectItem value="vendor_payments">Vendor Payments</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Accounts Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <AccountCardSkeleton key={i} />)}
            </div>
          ) : accounts.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">No accounts found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {accountTypeFilter !== 'all' || purposeFilter !== 'all' || statusFilter !== 'all'
                      ? 'Try changing your filters or add a new account.'
                      : 'Get started by adding your first owner account.'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />Add Account
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((account, i) => renderAccountCard(account, i))}
            </div>
          )}
        </TabsContent>

        {/* ── Sub-tab: Settlements ──────────────────────────────────────── */}
        <TabsContent value="settlements" className="space-y-4 mt-4">
          {renderSettlementsTable()}
        </TabsContent>
      </Tabs>
    </div>
  )
}
