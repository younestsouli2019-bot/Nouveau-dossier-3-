'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import OwnerAccountsTab from '@/components/dashboard/owner-accounts'
import {
  Truck, Package, CreditCard, MapPin, AlertTriangle, CheckCircle2, XCircle, Clock,
  ShieldAlert, ShieldCheck, ArrowRight, ArrowUpDown, RefreshCw, Eye, ExternalLink,
  PackageCheck, PackageX, DollarSign, Wallet, TrendingUp, ArrowUpRight, Activity,
  ChevronDown, ChevronRight, AlertCircle, Info, Ban, Wrench, CircleDot,
  Ship, Plane, Train, TruckIcon, MapPinned, Target, Banknote, Coins,
  Sun, Moon, Search, Filter, Download, MoreHorizontal, Copy, Check,
  ClipboardCheck, Building2, ThumbsUp, ThumbsDown, Send, Globe, Mail,
} from 'lucide-react'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip as ShTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProcurementSummary { totalItems: number; totalEstValue: number; byStatus: Record<string, number>; byCategory: Record<string, number> }
interface ProcurementItem {
  id: string; name: string; brand: string | null; reference: string | null; category: string
  quantity: number; unitPriceEst: number; totalEst: number; currency: string
  recipientName: string; recipientAddress: string | null; deliveryAddress: string | null
  prePaidBySwarm: boolean; status: string; orderRef: string | null; supplier: string | null
  notes: string | null; priority: string; fulfillmentSource: string | null
  orderedAt: string | null; shippedAt: string | null; deliveredAt: string | null; createdAt: string
}

interface Shipment {
  id: string; shipmentNumber: string; procurementItemId: string | null; itemName: string
  quantity: number; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null
  trackingVerified: boolean; trackingVerifiedAt: string | null
  originCountry: string | null; originCity: string | null
  destinationName: string; destinationAddress: string | null
  destinationCountry: string; destinationCity: string | null
  purpose: string | null; status: string
  estimatedDelivery: string | null; actualDelivery: string | null
  weightKg: number | null; dimensions: string | null
  shippingCost: number; currency: string; insuranceValue: number | null; customsDutyEst: number | null
  notes: string | null; events: string | null; createdAt: string
}

interface ShipmentSummary { totalShipments: number; trackingNotVerified: number; inTransit: number; delivered: number; totalShippingCost: number; totalInsuranceValue: number; byStatus: Record<string, number>; byDestination: Record<string, number>; byCarrier: Record<string, number>; byPurpose: Record<string, number> }

interface OwnerPaymentConfig { id: string; label: string; splitPercentage: number; ribLabel: string | null; ribNumber: string | null; swiftCode: string | null; bankName: string | null; isActive: boolean; routingFixed: boolean; routingFixedAt: string | null; notes: string | null }
interface OwnerPayment { id: string; configId: string | null; configLabel: string; amount: number; currency: string; sourceTxRef: string | null; status: string; destinationType: string; destinationLabel: string | null; ribNumber: string | null; failureReason: string | null; recovered: boolean; recoveredAt: string | null; recoveryAmount: number | null; recoveryTxRef: string | null; createdAt: string }

interface Supplier {
  id: string; code: string; name: string; website: string | null; country: string | null
  contactEmail: string | null; paymentTerms: string; isActive: boolean
  totalOrders: number; totalSpend: number; deliveredOnTime: number; totalDelivered: number
  itemsWithDefect: number; onTimeRate: number; defectRate: number
}

interface PurchaseOrder {
  id: string; poNumber: string; title: string | null; supplierName: string; status: string
  priority: string; currency: string; lineItemCount: number; totalAmount: number
  submittedAt: string | null; approvedBy: string | null; approvedAt: string | null
  rejectedBy: string | null; rejectedAt: string | null; rejectionReason: string | null
  orderedAt: string | null; completedAt: string | null; batchRef: string | null
  notes: string | null; createdAt: string
}

interface POSummary { totalPOs: number; byStatus: Record<string, number>; pendingApprovalCount: number; totalValue: number }

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  label_created: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  picked_up: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  in_transit: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  customs: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  out_for_delivery: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  returned: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  ordered: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  shipped: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  stuck_in_transition: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  routed: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  recovered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  delivery_disputed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700',
  delivered_fabricated: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  partially_ordered: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  ordered: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const CARRIER_ICONS: Record<string, React.ReactNode> = {
  'DHL Express': <Plane className="w-4 h-4 text-red-500" />,
  'FedEx': <Plane className="w-4 h-4 text-purple-500" />,
  'UPS': <TruckIcon className="w-4 h-4 text-amber-600" />,
  'Aramex': <TruckIcon className="w-4 h-4 text-orange-500" />,
  'Colissimo': <TruckIcon className="w-4 h-4 text-blue-600" />,
  'Chronopost': <TruckIcon className="w-4 h-4 text-sky-500" />,
  'Amazon Logistics': <TruckIcon className="w-4 h-4 text-orange-600" />,
  'AliExpress Standard Shipping': <Ship className="w-4 h-4 text-red-400" />,
  'Yanwen': <TruckIcon className="w-4 h-4 text-slate-500" />,
  '4PX': <TruckIcon className="w-4 h-4 text-teal-500" />,
}

const CATEGORY_COLORS = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#6366f1', '#14b8a6', '#eab308', '#ec4899', '#84cc16', '#a855f7', '#0ea5e9', '#22c55e', '#ef4444', '#64748b']

const PURPOSE_LABELS: Record<string, string> = {
  'Home entertainment setup': '🎬 Home Entertainment',
  'Vehicle safety - commuting': '🚗 Vehicle Safety',
  'Household improvement': '🏠 Household',
  'Development workstations': '💻 Dev Workstations',
  'Office IT equipment': '🖥️ Office IT',
  'Shop surveillance system': '📹 Shop Security',
  'Home entertainment + content creation': '🎥 Content Creation',
  'Resale inventory - online shop': '📦 Resale Inventory',
  'Personal health supplements': '💊 Health Supplements',
  'Personal care': '💄 Personal Care',
  'Personal care - gift': '🎁 Gift',
  'Personal wardrobe': '👔 Wardrobe',
  'Outdoor activities': '👟 Outdoor',
  'Personal supplies': '🚬 Personal Supplies',
  'Household provisions': '🍽️ Provisions',
  'Kitchen equipment': '🍳 Kitchen',
  'Mixed household items': '🔧 Household Items',
  'Home furnishing': '🛋️ Furnishing',
  'Emergency communications': '📱 Emergency Comms',
  'Personal collection': '⭐ Collection',
  'Mobile workstation': '📱 Mobile Workstation',
  'Personal mobile device': '📱 Personal Mobile',
  'General procurement': '📦 General',
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtKg = (n: number | null) => n != null ? `${n.toFixed(1)} kg` : '-'

function getTrackingEvents(eventsJson: string | null): { date: string; status: string; location: string; description: string }[] {
  if (!eventsJson) return []
  try { return JSON.parse(eventsJson) } catch { return [] }
}

function getShipmentStatusIcon(status: string) {
  switch (status) {
    case 'delivered': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
    case 'delivery_disputed': return <Ban className="w-4 h-4 text-red-600" />
    case 'failed': case 'returned': return <XCircle className="w-4 h-4 text-red-500" />
    case 'customs': return <AlertTriangle className="w-4 h-4 text-amber-500" />
    case 'in_transit': case 'picked_up': case 'out_for_delivery': return <Truck className="w-4 h-4 text-blue-500" />
    default: return <Clock className="w-4 h-4 text-slate-400" />
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

// ─── Skeletons ───────────────────────────────────────────────────────────────

function CardSkeleton() { return <Card><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-20" /></CardHeader><CardContent><Skeleton className="h-4 w-32" /></CardContent></Card> }
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SupplyChainDashboard() {
  const { theme, setTheme } = useTheme()
  const [seedLoading, setSeedLoading] = useState(false)
  const [fixLoading, setFixLoading] = useState(false)
  const [fixAllLoading, setFixAllLoading] = useState(false)
  const [verifyAllLoading, setVerifyAllLoading] = useState(false)
  const [advanceLoading, setAdvanceLoading] = useState(false)
  const [progressLog, setProgressLog] = useState<{ msg: string; time: string; type: 'verify' | 'advance' | 'success' | 'info' }[]>([])
  const [expandedShipment, setExpandedShipment] = useState<string | null>(null)
  const [procFilter, setProcFilter] = useState<string>('all')
  const [procCatFilter, setProcCatFilter] = useState<string>('all')
  const [shipStatusFilter, setShipStatusFilter] = useState<string>('all')
  const [payFilter, setPayFilter] = useState<string>('all')
  const [orderSearch, setOrderSearch] = useState('')

  // ── Data State ──
  const [procData, setProcData] = useState<{ items: ProcurementItem[]; summary: ProcurementSummary } | null>(null)
  const [shipData, setShipData] = useState<{ shipments: Shipment[]; summary: ShipmentSummary } | null>(null)
  const [payData, setPayData] = useState<{ configs: OwnerPaymentConfig[]; payments: OwnerPayment[]; summary: { total: number; totalAmount: number; stuckAmount: number } } | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [poData, setPoData] = useState<{ orders: PurchaseOrder[]; summary: POSummary } | null>(null)
  const [supplierData, setSupplierData] = useState<Supplier[]>([])
  const [poFilter, setPoFilter] = useState<string>('all')
  const [procSubTab, setProcSubTab] = useState<'overview' | 'orders' | 'suppliers'>('overview')
  const [ownerAccData, setOwnerAccData] = useState<{ accounts: any[]; summary: any } | null>(null)

  const procItems: ProcurementItem[] = procData?.items ?? []
  const procSummary: ProcurementSummary = procData?.summary ?? { totalItems: 0, totalEstValue: 0, byStatus: {}, byCategory: {} }
  const shipments: Shipment[] = shipData?.shipments ?? []
  const shipSummary: ShipmentSummary = shipData?.summary ?? { totalShipments: 0, trackingNotVerified: 0, inTransit: 0, delivered: 0, totalShippingCost: 0, totalInsuranceValue: 0, byStatus: {}, byDestination: {}, byCarrier: {}, byPurpose: {} }
  const payConfigs: OwnerPaymentConfig[] = payData?.configs ?? []
  const payPayments: OwnerPayment[] = payData?.payments ?? []
  const paySummary = payData?.summary ?? { total: 0, totalAmount: 0, stuckAmount: 0 }

  const fetchData = useCallback(async () => {
    try {
      const [p, s, y, oa] = await Promise.all([
        fetch('/api/procurement').then(r => r.json()),
        fetch('/api/shipments').then(r => r.json()),
        fetch('/api/owner-payments').then(r => r.json()),
        fetch('/api/owner-accounts').then(r => r.json()).catch(() => null),
      ])
      if (p.success) setProcData(p)
      if (s.success) setShipData(s)
      if (y.success) setPayData(y)
      if (oa?.success) setOwnerAccData({ accounts: oa.data, summary: oa.summary })
    } catch (e) { console.error('Fetch error:', e) }
    setDataLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => { fetch('/api/purchase-orders').then(r => r.json()).then(d => { if (d.success) setPoData(d) }) }, [])
  useEffect(() => { fetch('/api/suppliers').then(r => r.json()).then(d => { if (d.success) setSupplierData(d.suppliers || []) }) }, [])

  // ── PO Actions ──
  const handlePOAction = async (id: string, action: 'submit' | 'approve' | 'reject', reason?: string) => {
    const url = action === 'reject' ? `/api/purchase-orders/${id}/reject` : `/api/purchase-orders/${id}/${action}`
    const body = action === 'reject' ? { reason } : {}
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (data.success) {
      toast.success(`PO ${action}d successfully`)
      const poRes = await fetch('/api/purchase-orders').then(r => r.json())
      if (poRes.success) setPoData(poRes)
    } else {
      toast.error(data.error || `Failed to ${action} PO`)
    }
  }

  const handleBulkApprove = async () => {
    if (!poData) return
    const pendingIds = poData.orders.filter(o => o.status === 'pending_approval').map(o => o.id)
    if (pendingIds.length === 0) { toast.info('No pending approvals'); return }
    const res = await fetch('/api/purchase-orders/bulk-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poIds: pendingIds }) })
    const data = await res.json()
    if (data.success) {
      toast.success(`Approved ${data.approved} POs (${data.skipped} skipped)`)
      const poRes = await fetch('/api/purchase-orders').then(r => r.json())
      if (poRes.success) setPoData(poRes)
    } else {
      toast.error(data.error || 'Bulk approve failed')
    }
  }

  // ── Actions ──
  const [seedDialogOpen, setSeedDialogOpen] = useState(false)
  const handleSeed = async () => {
    setSeedLoading(true)
    setSeedDialogOpen(false)
    try {
      const res = await fetch('/api/supply-chain/seed', { method: 'POST' })
      const d = await res.json()
      if (d.success) {
        toast.success(d.message || 'Seeded!')
        fetchData()
      } else {
        toast.error(d.error || 'Seed blocked')
      }
    } catch { toast.error('Seed failed') }
    setSeedLoading(false)
  }
  const handleFixRouting = async () => {
    setFixLoading(true)
    try { const d = await fetch('/api/owner-payments/fix-routing', { method: 'POST' }).then(r => r.json()); toast.success(d.message || 'Salary routing fixed!'); fetchData() }
    catch { toast.error('Fix failed') }
    setFixLoading(false)
  }
  const handleFixAllRouting = async () => {
    setFixAllLoading(true)
    try { const d = await fetch('/api/owner-payments/fix-all-routing', { method: 'POST' }).then(r => r.json()); toast.success(d.message || 'All routing fixed!'); fetchData() }
    catch { toast.error('Fix failed') }
    setFixAllLoading(false)
  }
  const handleVerify = async (shipmentId: string, verified: boolean) => {
    try { const d = await fetch('/api/shipments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shipmentId, verified }) }).then(r => r.json()); toast.success(d.shipment ? 'Tracking verified' : 'Updated'); fetchData() }
    catch { toast.error('Verify failed') }
  }
  const handleVerifyAll = async () => {
    setVerifyAllLoading(true)
    try {
      const d = await fetch('/api/shipments/verify-all', { method: 'POST' }).then(r => r.json())
      toast.success(d.message)
      setProgressLog(prev => [{ msg: d.message, time: new Date().toLocaleTimeString(), type: d.verified > 0 ? 'verify' : 'info' }, ...prev].slice(0, 30))
      fetchData()
    } catch { toast.error('Auto-verify failed') }
    setVerifyAllLoading(false)
  }
  const handleAdvanceProgress = async (steps = 1) => {
    setAdvanceLoading(true)
    try {
      const d = await fetch('/api/shipments/advance-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps }) }).then(r => r.json())
      toast.success(d.message)
      setProgressLog(prev => [{ msg: d.message, time: new Date().toLocaleTimeString(), type: d.delivered > 0 ? 'success' : 'advance' }, ...prev].slice(0, 30))
      if (d.details) {
        for (const det of d.details) {
          setProgressLog(prev => [{ msg: `${det.shipmentNumber}: ${det.item} → ${det.to}`, time: new Date().toLocaleTimeString(), type: 'advance' }, ...prev].slice(0, 30))
        }
      }
      fetchData()
    } catch { toast.error('Advance failed') }
    setAdvanceLoading(false)
  }

  // ── Derived ──
  const stuckPayments = payPayments.filter(p => p.status === 'stuck_in_transition')
  const stuckAmount = stuckPayments.reduce((s, p) => s + p.amount, 0)
  const disputedShipments = shipments.filter(s => s.status === 'delivery_disputed')
  const configsNotFixed = payConfigs.filter(c => !c.routingFixed && c.isActive)

  const filteredProc = useMemo(() => {
    let items = procItems
    if (procFilter !== 'all') items = items.filter(i => i.status === procFilter)
    if (procCatFilter !== 'all') items = items.filter(i => i.category === procCatFilter)
    return items
  }, [procItems, procFilter, procCatFilter])

  const filteredShip = useMemo(() => {
    let items = shipments
    if (shipStatusFilter !== 'all') items = items.filter(s => s.status === shipStatusFilter)
    return items
  }, [shipments, shipStatusFilter])

  const filteredPay = useMemo(() => {
    let items = payPayments
    if (payFilter !== 'all') items = items.filter(p => p.status === payFilter)
    return items
  }, [payPayments, payFilter])

  const filteredOrders = useMemo(() => {
    let items = procItems
    if (orderSearch) {
      const q = orderSearch.toLowerCase()
      items = items.filter(i => i.name.toLowerCase().includes(q) || i.recipientName.toLowerCase().includes(q) || (i.purpose || '').toLowerCase().includes(q) || (i.recipientAddress || '').toLowerCase().includes(q))
    }
    return items
  }, [procItems, orderSearch])

  const categoryChartData = Object.entries(procSummary.byCategory).map(([name, value], i) => ({ name, value, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
  const statusChartData = Object.entries(shipSummary.byStatus).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
  const purposeChartData = Object.entries(shipSummary.byPurpose).map(([name, value]) => ({ name: PURPOSE_LABELS[name] || name, value }))

  // ── Group orders by shipment/destination ──
  const ordersGrouped = useMemo(() => {
    const groups: Record<string, ProcurementItem[]> = {}
    for (const item of filteredOrders) {
      const key = `${item.recipientName}|||${item.recipientAddress || ''}`
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    return groups
  }, [filteredOrders])

  return (
    <TooltipProvider>
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 text-white">
              <Ship className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Supply Chain</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Procurement · Shipments · Payments · Tracking</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog open={seedDialogOpen} onOpenChange={setSeedDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={seedLoading} className="text-xs gap-1.5">
                  <RefreshCw className={`w-3.5 h-3.5 ${seedLoading ? 'animate-spin' : ''}`} />
                  {procItems.length > 0 ? 'Re-seed' : 'Initialize Data'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />{procItems.length > 0 ? 'Reset all data?' : 'Initialize seed data?'}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {procItems.length > 0
                      ? `This will DELETE all ${procItems.length} procurement items, ${poData?.summary?.totalPOs ?? 0} purchase orders, and ${shipments.length} shipments — then re-create them from scratch. All status changes, re-sourcing, and delivery confirmations will be LOST.`
                      : 'This will populate the database with sample procurement, shipment, and payment data.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSeed} className="bg-red-600 hover:bg-red-700">
                    {procItems.length > 0 ? 'Yes, reset everything' : 'Initialize'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <a href="/rwc-social" className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 hover:bg-background px-2.5 py-1.5 text-xs font-medium text-foreground">
              <Target className="w-3.5 h-3.5 text-cyan-500" />
              RWC Social
            </a>
            <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 h-auto p-1 bg-muted/50 overflow-x-auto">
            <TabsTrigger value="accounts" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Wallet className="w-3.5 h-3.5 hidden sm:block" />Accounts</TabsTrigger>
            <TabsTrigger value="dashboard" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Activity className="w-3.5 h-3.5 hidden sm:block" />Dashboard</TabsTrigger>
            <TabsTrigger value="payments" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><CreditCard className="w-3.5 h-3.5 hidden sm:block" />Payments</TabsTrigger>
            <TabsTrigger value="orders" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Package className="w-3.5 h-3.5 hidden sm:block" />Orders</TabsTrigger>
            <TabsTrigger value="shipments" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Truck className="w-3.5 h-3.5 hidden sm:block" />Shipments</TabsTrigger>
            <TabsTrigger value="procurement" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><PackageCheck className="w-3.5 h-3.5 hidden sm:block" />Procurement</TabsTrigger>
          </TabsList>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: ACCOUNTS
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="accounts" className="space-y-6">
            <OwnerAccountsTab initialAccounts={ownerAccData?.accounts} initialSummary={ownerAccData?.summary} />
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: DASHBOARD
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Total Procurement</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{procSummary.totalItems}</p><p className="text-xs text-muted-foreground">{fmt(procSummary.totalEstValue)}</p></CardContent></Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Shipments</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{shipSummary.totalShipments}</p><p className="text-xs text-blue-600">{shipSummary.inTransit} in transit</p></CardContent></Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card className="border-amber-200 dark:border-amber-800 hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs text-amber-600 dark:text-amber-400">Tracking NOT Verified</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-amber-600">{shipSummary.trackingNotVerified}</p><p className="text-xs text-muted-foreground">of {shipments.filter(s => s.trackingNumber).length} with numbers</p></CardContent></Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <Card className="border-emerald-200 dark:border-emerald-800 hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs text-emerald-600 dark:text-emerald-400">Delivered</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-emerald-600">{shipSummary.delivered}</p><p className="text-xs text-muted-foreground">successfully received</p></CardContent></Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="border-red-200 dark:border-red-800 hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs text-red-600 dark:text-red-400">Stuck Payments</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-red-600">{stuckPayments.length}</p><p className="text-xs text-muted-foreground">{fmt(stuckAmount)} trapped</p></CardContent></Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Shipping Cost</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(shipSummary.totalShippingCost)}</p><p className="text-xs text-muted-foreground">{fmt(shipSummary.totalInsuranceValue)} insured</p></CardContent></Card>
              </motion.div>
            </div>

            {/* Charts Row */}
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="text-sm">By Category</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={categoryChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={2}>{categoryChartData.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie><Tooltip formatter={(v: number) => [v, 'items']} /></PieChart></ResponsiveContainer>
                <div className="flex flex-wrap gap-1.5 mt-2">{categoryChartData.slice(0, 8).map((d, i) => <Badge key={i} variant="secondary" className="text-[10px] gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name} ({d.value})</Badge>)}</div>
              </CardContent></Card>

              <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="text-sm">Shipment Status</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={200}><BarChart data={statusChartData}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </CardContent></Card>

              <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="text-sm">By Purpose</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={200}><BarChart data={purposeChartData} layout="vertical"><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={120} /><Tooltip /><Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
              </CardContent></Card>
            </div>

            {/* Destination Breakdown + Alerts */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Destination Breakdown</CardTitle></CardHeader><CardContent>
                <div className="space-y-2.5">
                  {Object.entries(shipSummary.byDestination).map(([dest, count]) => {
                    const pct = Math.round((count / shipSummary.totalShipments) * 100)
                    return <div key={dest} className="space-y-1"><div className="flex justify-between text-sm"><span className="font-medium">{dest}</span><span className="text-muted-foreground">{count} shipments ({pct}%)</span></div><Progress value={pct} className="h-2" /></div>
                  })}
                  {Object.keys(shipSummary.byDestination).length === 0 && <p className="text-sm text-muted-foreground">No data yet. Click &quot;Initialize Data&quot; to seed.</p>}
                </div>
              </CardContent></Card>

              <Card className="border-amber-200 dark:border-amber-900"><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Active Alerts</CardTitle></CardHeader><CardContent><div className="space-y-3">
                {disputedShipments.length > 0 && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"><Ban className="w-4 h-4 text-red-600 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-red-700 dark:text-red-400">{disputedShipments.length} Delivery Dispute{disputedShipments.length > 1 ? 's' : ''} — Fraudulent Tracking</p><p className="text-xs text-muted-foreground">Carrier generated future-dated events. No package was received. See Shipments tab for details.</p></div></div>}
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30"><ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-red-700 dark:text-red-400">{stuckPayments.length} Payments Stuck in Transition</p><p className="text-xs text-muted-foreground">{fmt(stuckAmount)} trapped in Banking Circle / Operational Pool. Salary routing was never configured to reach owner RIB.</p><Button size="sm" variant="destructive" className="mt-1.5 h-7 text-xs" onClick={handleFixAllRouting} disabled={fixAllLoading}>{fixAllLoading ? 'Fixing...' : 'Fix All Routing'}</Button></div></div>
                {shipSummary.trackingNotVerified > 0 && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30"><AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-amber-700 dark:text-amber-400">{shipSummary.trackingNotVerified} Tracking Numbers NOT VERIFIED</p><p className="text-xs text-muted-foreground">Tracking codes have been assigned but carrier verification is pending. Use "Verify All" in the Shipments tab.</p></div></div>}
                {shipSummary.trackingNotVerified === 0 && shipSummary.totalShipments > 0 && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">All Tracking Numbers Verified</p><p className="text-xs text-muted-foreground">{shipSummary.totalShipments} shipments · {shipSummary.delivered} delivered ({Math.round((shipSummary.delivered / Math.max(shipSummary.totalShipments, 1)) * 100)}%)</p></div></div>}
                {configsNotFixed.length > 0 && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/30"><Wrench className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-orange-700 dark:text-orange-400">{configsNotFixed.length} Payment Routes Unfixed</p><p className="text-xs text-muted-foreground">Auto-split configs exist but routing to external accounts has not been corrected.</p></div></div>}
              </div></CardContent></Card>
            </div>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: PAYMENTS
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="payments" className="space-y-6">
            <div className="grid md:grid-cols-3 gap-3">
              <Card><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Total Payments</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{fmt(paySummary.totalAmount || 0)}</p><p className="text-xs text-muted-foreground">{payPayments.length} transactions</p></CardContent></Card>
              <Card className="border-red-200 dark:border-red-800"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs text-red-600">Stuck in Transition</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-red-600">{fmt(stuckAmount)}</p><p className="text-xs text-muted-foreground">{stuckPayments.length} payments</p></CardContent></Card>
              <Card className="border-emerald-200 dark:border-emerald-800"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs text-emerald-600">Configs Fixed</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-emerald-600">{payConfigs.filter(c => c.routingFixed).length}/{payConfigs.length}</p><p className="text-xs text-muted-foreground">routing corrected</p></CardContent></Card>
            </div>

            {/* Auto-Split Config */}
            <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><ArrowRight className="w-4 h-4" />Auto-Split Configuration</CardTitle><CardDescription>Revenue distribution rules — routing to external bank accounts</CardDescription></CardHeader><CardContent>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Allocation</TableHead><TableHead>Percentage</TableHead><TableHead>Destination RIB</TableHead><TableHead>Bank</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>
                {payConfigs.map(cfg => (
                  <TableRow key={cfg.id}>
                    <TableCell className="font-medium text-sm">{cfg.label}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono text-xs">{cfg.splitPercentage}%</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{cfg.ribNumber ? <span>{cfg.ribNumber.slice(-12)}...{cfg.ribNumber.slice(-2)}<CopyButton text={cfg.ribNumber} /></span> : '-'}</TableCell>
                    <TableCell className="text-xs">{cfg.bankName || '-'}<br /><span className="text-muted-foreground">{cfg.swiftCode || ''}</span></TableCell>
                    <TableCell>
                      {cfg.routingFixed
                        ? <Badge className={STATUS_COLORS.recovered}><ShieldCheck className="w-3 h-3 mr-1" />Fixed</Badge>
                        : <Badge className={STATUS_COLORS.stuck_in_transition}><ShieldAlert className="w-3 h-3 mr-1" />Unfixed</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{cfg.notes || '-'}</TableCell>
                  </TableRow>
                ))}
                {payConfigs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No configs. Initialize data first.</TableCell></TableRow>}
              </TableBody></Table>
              </div>
              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="destructive" onClick={handleFixRouting} disabled={fixLoading}>{fixLoading ? 'Fixing...' : 'Fix Salary Routing'}</Button>
                <Button size="sm" variant="destructive" onClick={handleFixAllRouting} disabled={fixAllLoading}>{fixAllLoading ? 'Fixing...' : 'Fix ALL Routing'}</Button>
              </div>
            </CardContent></Card>

            {/* Payment Records */}
            <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-sm">Payment Records</CardTitle><CardDescription>All owner payment transactions</CardDescription></div>
                  <Select value={payFilter} onValueChange={setPayFilter}><SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="stuck_in_transition">Stuck</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="routed">Routed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="recovered">Recovered</SelectItem>
                  </SelectContent></Select></div></CardHeader><CardContent>
              <ScrollArea className="max-h-[400px]">
                <Table><TableHeader><TableRow><TableHead>Config</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Destination Type</TableHead><TableHead>Destination</TableHead><TableHead>Recovery</TableHead><TableHead>Date</TableHead></TableRow></TableHeader><TableBody>
                  {filteredPay.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">{p.configLabel}</TableCell>
                      <TableCell className="font-mono text-sm">{fmt(p.amount)}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[p.status] || ''}>{p.status.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-xs"><span className={`inline-flex items-center gap-1 ${p.destinationType === 'external_bank' ? 'text-emerald-600' : 'text-red-600'}`}>{p.destinationType === 'external_bank' ? <Banknote className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}{p.destinationType.replace(/_/g, ' ')}</span></TableCell>
                      <TableCell className="text-xs font-mono max-w-[140px] truncate">{p.destinationLabel || p.ribNumber || '-'}</TableCell>
                      <TableCell>{p.recovered ? <Badge className={STATUS_COLORS.recovered}>Recovered {p.recoveryAmount ? fmt(p.recoveryAmount) : ''}</Badge> : p.status === 'stuck_in_transition' ? <Badge variant="outline" className="text-red-500">Pending</Badge> : '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.createdAt ? format(new Date(p.createdAt), 'MMM d, yyyy') : '-'}</TableCell>
                    </TableRow>
                  ))}
                  {filteredPay.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No payments found.</TableCell></TableRow>}
                </TableBody></Table>
              </ScrollArea>
            </CardContent></Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: ORDERS
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="orders" className="space-y-6">
            <Card><CardHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><CardTitle className="text-sm">Order Details — What, Where & Why</CardTitle><CardDescription>Complete breakdown of every procurement item with destination and purpose</CardDescription></div>
              <div className="flex gap-2 items-center"><Search className="w-4 h-4 text-muted-foreground" /><Input placeholder="Search items, recipients, purposes..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} className="h-8 w-64 text-xs" /></div></div></CardHeader><CardContent>
              <ScrollArea className="max-h-[600px]">
                {Object.entries(ordersGrouped).map(([key, items]) => {
                  const [recipient, addr] = key.split('|||')
                  const groupTotal = items.reduce((s, i) => s + i.totalEst, 0)
                  const matchShip = shipments.find(s => s.destinationName === recipient)
                  return (
                    <div key={key} className="mb-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-orange-500" />
                          <span className="font-semibold text-sm">{recipient}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MapPinned className="w-3.5 h-3.5" />{addr || 'No address'}
                          <Separator orientation="vertical" className="h-3.5" />
                          <span className="font-medium text-foreground">{items.length} items</span>
                          <Separator orientation="vertical" className="h-3.5" />
                          <span className="font-medium text-foreground">{fmt(groupTotal)}</span>
                          <Separator orientation="vertical" className="h-3.5" />
                          <Badge variant="outline" className="text-emerald-600">Pre-paid by Swarm</Badge>
                        </div>
                      </div>
                      <Table><TableHeader><TableRow><TableHead className="w-8">#</TableHead><TableHead>Item</TableHead><TableHead>Brand / Ref</TableHead><TableHead className="text-center">Qty</TableHead><TableHead>Unit Est.</TableHead><TableHead>Total</TableHead><TableHead>Purpose</TableHead><TableHead>Carrier</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                        {items.map((item, idx) => {
                          const ship = shipments.find(s => s.itemName === item.name && s.destinationName === item.recipientName)
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                              <TableCell><div className="text-sm font-medium">{item.name}</div><div className="text-[10px] text-muted-foreground">{item.category.replace(/_/g, ' ')}</div></TableCell>
                              <TableCell className="text-xs"><div>{item.brand || '-'}</div><div className="text-muted-foreground font-mono">{item.reference || ''}</div></TableCell>
                              <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                              <TableCell className="font-mono text-sm">{fmt(item.unitPriceEst)}</TableCell>
                              <TableCell className="font-mono text-sm font-medium">{fmt(item.totalEst)}</TableCell>
                              <TableCell className="text-xs max-w-[180px]">{ship?.purpose ? <ShTooltip><TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">{PURPOSE_LABELS[ship.purpose] || ship.purpose}</TooltipTrigger><TooltipContent className="max-w-xs text-xs">{ship.purpose}<br />Origin: {ship.originCity}, {ship.originCountry}<br />Weight: {fmtKg(ship.weightKg)}</TooltipContent></ShTooltip> : '-'}</TableCell>
                              <TableCell className="text-xs">{ship?.carrier ? <span className="inline-flex items-center gap-1">{CARRIER_ICONS[ship.carrier] || <TruckIcon className="w-3.5 h-3.5" />}{ship.carrier}</span> : '-'}</TableCell>
                              <TableCell><Badge className={`${STATUS_COLORS[item.status] || ''} text-[10px]`}>{item.status}</Badge></TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody></Table>
                    </div>
                  )
                })}
                {Object.keys(ordersGrouped).length === 0 && <div className="text-center py-12 text-muted-foreground">No orders found. {orderSearch ? 'Try a different search term.' : 'Initialize data first.'}</div>}
              </ScrollArea>
            </CardContent></Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: SHIPMENTS
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="shipments" className="space-y-6">
            {/* Progress Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className={shipSummary.trackingNotVerified === 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-amber-200 dark:border-amber-800'}><CardHeader className="pb-1 pt-3 px-3"><CardDescription className="text-[10px] uppercase tracking-wider">Tracking Verified</CardDescription></CardHeader><CardContent className="px-3 pb-3"><div className="flex items-end gap-2"><p className="text-xl font-bold">{shipments.filter(s => s.trackingVerified).length}</p><span className="text-xs text-muted-foreground pb-1">/ {shipments.filter(s => s.trackingNumber).length}</span></div><Progress value={shipments.filter(s => s.trackingNumber).length > 0 ? (shipments.filter(s => s.trackingVerified).length / shipments.filter(s => s.trackingNumber).length) * 100 : 0} className="h-1.5 mt-2" /><p className="text-[10px] text-muted-foreground mt-1">{shipSummary.trackingNotVerified > 0 ? `${shipSummary.trackingNotVerified} remaining` : 'All verified ✓'}</p></CardContent></Card>
              <Card><CardHeader className="pb-1 pt-3 px-3"><CardDescription className="text-[10px] uppercase tracking-wider">In Transit</CardDescription></CardHeader><CardContent className="px-3 pb-3"><p className="text-xl font-bold text-blue-600">{shipSummary.inTransit}</p><p className="text-[10px] text-muted-foreground">picked up · in transit · customs</p></CardContent></Card>
              <Card className="border-emerald-200 dark:border-emerald-800"><CardHeader className="pb-1 pt-3 px-3"><CardDescription className="text-[10px] uppercase tracking-wider">Delivered</CardDescription></CardHeader><CardContent className="px-3 pb-3"><div className="flex items-end gap-2"><p className="text-xl font-bold text-emerald-600">{shipSummary.delivered}</p><span className="text-xs text-muted-foreground pb-1">/ {shipSummary.totalShipments}</span></div><Progress value={shipSummary.totalShipments > 0 ? (shipSummary.delivered / shipSummary.totalShipments) * 100 : 0} className="h-1.5 mt-2" /><p className="text-[10px] text-muted-foreground mt-1">{Math.round((shipSummary.delivered / Math.max(shipSummary.totalShipments, 1)) * 100)}% complete</p></CardContent></Card>
              <Card><CardHeader className="pb-1 pt-3 px-3"><CardDescription className="text-[10px] uppercase tracking-wider">Total Shipping</CardDescription></CardHeader><CardContent className="px-3 pb-3"><p className="text-xl font-bold">{fmt(shipSummary.totalShippingCost)}</p><p className="text-[10px] text-muted-foreground">{fmt(shipSummary.totalInsuranceValue)} insured</p></CardContent></Card>
            </div>

            {/* Action Bar + Progress Log */}
            <Card><CardHeader className="pb-3"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><CardTitle className="text-sm">Shipment Tracking</CardTitle><CardDescription className={shipSummary.trackingNotVerified > 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>{shipSummary.trackingNotVerified > 0 ? `${shipSummary.trackingNotVerified} tracking numbers not verified` : 'All tracking numbers verified ✓'}</CardDescription></div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleVerifyAll} disabled={verifyAllLoading || shipSummary.trackingNotVerified === 0}>{verifyAllLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}{shipSummary.trackingNotVerified === 0 ? 'All Verified' : `Verify All (${shipSummary.trackingNotVerified})`}</Button>
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => handleAdvanceProgress(1)} disabled={advanceLoading || shipSummary.delivered === shipSummary.totalShipments}>{advanceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}Advance +1 Step</Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => handleAdvanceProgress(6)} disabled={advanceLoading || shipSummary.delivered === shipSummary.totalShipments}>{advanceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}Fast Forward All</Button>
                    <Select value={shipStatusFilter} onValueChange={setShipStatusFilter}><SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="label_created">Label Created</SelectItem>
                    <SelectItem value="in_transit">In Transit</SelectItem>
                    <SelectItem value="customs">Customs</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="delivery_disputed">Disputed</SelectItem>
                  </SelectContent></Select></div></div></CardHeader><CardContent>
              {/* Progress Log */}
              {progressLog.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-muted/50 max-h-32 overflow-y-auto">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Progress Log</p>
                  <div className="space-y-1">
                    {progressLog.map((log, i) => (
                      <div key={i} className={`flex items-start gap-2 text-xs ${log.type === 'success' ? 'text-emerald-600' : log.type === 'verify' ? 'text-blue-600' : 'text-muted-foreground'}`}>
                        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">{log.time}</span>
                        <span>{log.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-2">
                  {filteredShip.map(ship => {
                    const events = getTrackingEvents(ship.events)
                    const isExpanded = expandedShipment === ship.id
                    return (
                      <Card key={ship.id} className={`border ${!ship.trackingVerified && ship.trackingNumber ? 'border-amber-200 dark:border-amber-900' : ''} ${ship.status === 'delivered' ? 'border-emerald-200 dark:border-emerald-900' : ''} ${ship.status === 'delivery_disputed' ? 'border-red-400 dark:border-red-700 ring-2 ring-red-200 dark:ring-red-900' : ''} transition-all`}>
                        <div className="p-3 sm:p-4 cursor-pointer" onClick={() => setExpandedShipment(isExpanded ? null : ship.id)}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {getShipmentStatusIcon(ship.status)}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm truncate">{ship.itemName}</span>
                                  <Badge variant="outline" className="text-[10px] font-mono">{ship.shipmentNumber}</Badge>
                                  {!ship.trackingVerified && ship.trackingNumber && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 text-[10px]">NOT VERIFIED</Badge>}
                                  {ship.trackingVerified && <Badge className={STATUS_COLORS.delivered + ' text-[10px]'}><CheckCircle2 className="w-3 h-3 mr-0.5" />Verified</Badge>}
                                  {ship.status === 'delivery_disputed' && <Badge className="bg-red-600 text-white text-[10px] gap-1"><Ban className="w-3 h-3" />DISPUTED — FRAUDULENT TRACKING</Badge>}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                  {ship.carrier && <span className="inline-flex items-center gap-1">{CARRIER_ICONS[ship.carrier] || <TruckIcon className="w-3 h-3" />}{ship.carrier}</span>}
                                  {ship.trackingNumber && <span className="font-mono">{ship.trackingNumber}<CopyButton text={ship.trackingNumber} /></span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <Badge className={`${STATUS_COLORS[ship.status] || ''} text-[10px]`}>{ship.status.replace(/_/g, ' ')}</Badge>
                                {ship.estimatedDelivery && <p className="text-[10px] text-muted-foreground mt-0.5">ETA: {format(new Date(ship.estimatedDelivery), 'MMM d')}</p>}
                              </div>
                              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                          </div>
                        </div>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                              <div className="px-4 pb-4 pt-0 border-t">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                                  <div><span className="text-muted-foreground">Origin</span><p className="font-medium mt-0.5">{ship.originCity}, {ship.originCountry}</p></div>
                                  <div><span className="text-muted-foreground">Destination</span><p className="font-medium mt-0.5">{ship.destinationName}</p><p className="text-muted-foreground">{ship.destinationAddress}</p></div>
                                  <div><span className="text-muted-foreground">Purpose</span><p className="font-medium mt-0.5">{PURPOSE_LABELS[ship.purpose || ''] || ship.purpose || '-'}</p></div>
                                  <div><span className="text-muted-foreground">Details</span><p className="mt-0.5">Weight: {fmtKg(ship.weightKg)}</p><p>Dims: {ship.dimensions || '-'}</p></div>
                                  <div><span className="text-muted-foreground">Shipping</span><p className="font-mono mt-0.5">{fmt(ship.shippingCost)}</p></div>
                                  <div><span className="text-muted-foreground">Insurance</span><p className="font-mono mt-0.5">{ship.insuranceValue ? fmt(ship.insuranceValue) : '-'}</p></div>
                                  <div><span className="text-muted-foreground">Customs Est.</span><p className="font-mono mt-0.5">{ship.customsDutyEst ? fmt(ship.customsDutyEst) : '-'}</p></div>
                                  <div><span className="text-muted-foreground">Qty</span><p className="font-medium mt-0.5">{ship.quantity}</p></div>
                                </div>

                                {/* Dispute Alert Banner */}
                                {ship.status === 'delivery_disputed' && ship.notes && (
                                  <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800">
                                    <div className="flex items-start gap-2">
                                      <ShieldAlert className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                                      <div>
                                        <p className="text-xs font-semibold text-red-700 dark:text-red-400">Delivery Disputed — Fraudulent Tracking Detected</p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{ship.notes}</p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {/* Tracking Events Timeline */}
                                {events.length > 0 && (
                                  <div className="mt-4">
                                    <p className="text-xs font-medium mb-2">Tracking Timeline</p>
                                    <div className="relative pl-4 space-y-2 border-l-2 border-muted">
                                      {events.map((ev, i) => {
                                        const isFabricated = ev.description?.includes('[FABRICATED')
                                        const isDispute = ev.status === 'delivery_disputed'
                                        return (
                                        <div key={i} className="relative flex items-start gap-3">
                                          <div className={`absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2 border-background ${isFabricated ? 'bg-red-500' : isDispute ? 'bg-red-600 ring-2 ring-red-300' : 'bg-primary'}`} />
                                          <div className={isFabricated ? 'line-through opacity-60' : ''}>
                                            <p className={`text-xs font-medium ${isDispute ? 'text-red-700 dark:text-red-400 font-bold' : ''}`}>{ev.description}</p>
                                            <p className={`text-[10px] ${isFabricated ? 'text-red-500' : 'text-muted-foreground'}`}>{ev.location} · {ev.date ? format(new Date(ev.date), 'MMM d, yyyy HH:mm') : ''}{isFabricated && ' — FUTURE DATE (FABRICATED)'}</p>
                                          </div>
                                        </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Verify Button */}
                                <div className="mt-4 flex items-center gap-2">
                                  {!ship.trackingVerified && ship.trackingNumber && (
                                    <Button size="sm" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); handleVerify(ship.id, true) }}>
                                      <ShieldCheck className="w-3.5 h-3.5" />Verify Tracking
                                    </Button>
                                  )}
                                  {ship.trackingVerified && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); handleVerify(ship.id, false) }}>
                                      <Ban className="w-3.5 h-3.5" />Unverify
                                    </Button>
                                  )}
                                  {ship.trackingUrl && <a href={ship.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" onClick={e => e.stopPropagation()}><ExternalLink className="w-3 h-3" />Track on carrier site</a>}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Card>
                    )
                  })}
                  {filteredShip.length === 0 && <div className="text-center py-12 text-muted-foreground">No shipments found. Initialize data first.</div>}
                </div>
              </ScrollArea>
            </CardContent></Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: PROCUREMENT
             ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="procurement" className="space-y-6">
            {/* Sub-tab navigation */}
            <Tabs value={procSubTab} onValueChange={(v) => setProcSubTab(v as typeof procSubTab)}>
              <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/50">
                <TabsTrigger value="overview" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Activity className="w-3.5 h-3.5 hidden sm:block" />Overview</TabsTrigger>
                <TabsTrigger value="orders" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><ClipboardCheck className="w-3.5 h-3.5 hidden sm:block" />Purchase Orders</TabsTrigger>
                <TabsTrigger value="suppliers" className="text-xs sm:text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"><Building2 className="w-3.5 h-3.5 hidden sm:block" />Suppliers</TabsTrigger>
              </TabsList>

              {/* ── SUB-TAB: OVERVIEW ── */}
              <TabsContent value="overview" className="space-y-6 mt-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                    <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Total Purchase Orders</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{poData?.summary?.totalPOs ?? '-'}</p><p className="text-xs text-muted-foreground">across all statuses</p></CardContent></Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                    <Card className={`hover:shadow-md transition-shadow ${(poData?.summary?.pendingApprovalCount ?? 0) > 0 ? 'border-amber-200 dark:border-amber-800' : ''}`}><CardHeader className="pb-1 pt-4 px-4"><CardDescription className={`text-xs ${(poData?.summary?.pendingApprovalCount ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>Pending Approval</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className={`text-2xl font-bold ${(poData?.summary?.pendingApprovalCount ?? 0) > 0 ? 'text-amber-600' : ''}`}>{poData?.summary?.pendingApprovalCount ?? 0}</p><p className="text-xs text-muted-foreground">awaiting review</p></CardContent></Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                    <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Total PO Value</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{poData?.summary?.totalValue != null ? fmt(poData.summary.totalValue) : '-'}</p><p className="text-xs text-muted-foreground">all orders combined</p></CardContent></Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                    <Card className="hover:shadow-md transition-shadow"><CardHeader className="pb-1 pt-4 px-4"><CardDescription className="text-xs">Active Suppliers</CardDescription></CardHeader><CardContent className="px-4 pb-4"><p className="text-2xl font-bold">{supplierData.filter(s => s.isActive).length}</p><p className="text-xs text-muted-foreground">of {supplierData.length} total</p></CardContent></Card>
                  </motion.div>
                </div>

                {/* PO Status Pipeline */}
                <Card><CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ArrowRight className="w-4 h-4" />PO Status Pipeline</CardTitle></CardHeader><CardContent>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['draft', 'submitted', 'pending_approval', 'approved', 'ordered', 'completed'] as const).map((status, idx) => {
                      const count = poData?.summary?.byStatus?.[status] ?? 0
                      return (
                        <React.Fragment key={status}>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
                            <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[status]?.split(' ')[0] ?? 'bg-slate-300'}`} />
                            <div>
                              <p className="text-xs font-medium capitalize">{status.replace(/_/g, ' ')}</p>
                              <p className="text-lg font-bold">{count}</p>
                            </div>
                          </div>
                          {idx < 5 && <ArrowRight className="w-4 h-4 text-muted-foreground hidden sm:block" />}
                        </React.Fragment>
                      )
                    })}
                  </div>
                </CardContent></Card>

                {/* Recent POs */}
                <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Recent Purchase Orders</CardTitle><CardDescription>Latest 5 by creation date</CardDescription></CardHeader><CardContent>
                  <ScrollArea className="max-h-96 overflow-y-auto">
                    <Table><TableHeader><TableRow><TableHead>PO Number</TableHead><TableHead className="hidden sm:table-cell">Title</TableHead><TableHead>Supplier</TableHead><TableHead className="hidden md:table-cell">Status</TableHead><TableHead className="hidden md:table-cell">Items</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="hidden lg:table-cell">Created</TableHead></TableRow></TableHeader><TableBody>
                      {poData && [...poData.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5).map(po => (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-sm font-medium">{po.poNumber}</TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground max-w-[160px] truncate">{po.title || '-'}</TableCell>
                          <TableCell className="text-sm">{po.supplierName}</TableCell>
                          <TableCell className="hidden md:table-cell"><Badge className={`${STATUS_COLORS[po.status] || ''} text-[10px]`}>{po.status.replace(/_/g, ' ')}</Badge></TableCell>
                          <TableCell className="hidden md:table-cell text-center text-xs">{po.lineItemCount}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(po.totalAmount)}</TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{po.createdAt ? format(new Date(po.createdAt), 'MMM d, yyyy') : '-'}</TableCell>
                        </TableRow>
                      ))}
                      {(!poData || poData.orders.length === 0) && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No purchase orders yet.</TableCell></TableRow>}
                    </TableBody></Table>
                  </ScrollArea>
                </CardContent></Card>

                {/* Procurement Items Table (existing) */}
                <Card><CardHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><CardTitle className="text-sm">Procurement Items</CardTitle>
                      <div className="flex gap-2 items-center"><Filter className="w-3.5 h-3.5 text-muted-foreground" /><Select value={procCatFilter} onValueChange={setProcCatFilter}><SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>
                        {Object.entries(procSummary.byCategory).map(([cat]) => <SelectItem key={cat} value={cat}>{cat.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent></Select></div></div></CardHeader><CardContent>
                  <ScrollArea className="max-h-96 overflow-y-auto">
                    <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="hidden md:table-cell">Brand / Ref</TableHead><TableHead className="hidden sm:table-cell">Category</TableHead><TableHead className="text-center">Qty</TableHead><TableHead>Unit Est.</TableHead><TableHead>Total</TableHead><TableHead className="hidden lg:table-cell">Recipient</TableHead><TableHead>Status</TableHead><TableHead className="hidden lg:table-cell">Pre-paid</TableHead></TableRow></TableHeader><TableBody>
                      {filteredProc.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-sm max-w-[200px] truncate" title={item.name}>{item.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs"><div>{item.brand || '-'}</div><div className="font-mono text-muted-foreground">{item.reference || ''}</div></TableCell>
                          <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="text-[10px]">{item.category.replace(/_/g, ' ')}</Badge></TableCell>
                          <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                          <TableCell className="font-mono text-sm">{fmt(item.unitPriceEst)}</TableCell>
                          <TableCell className="font-mono text-sm font-medium">{fmt(item.totalEst)}</TableCell>
                          <TableCell className="hidden lg:table-cell text-xs"><div className="font-medium">{item.recipientName}</div><div className="text-muted-foreground truncate max-w-[180px]" title={item.recipientAddress || ''}>{item.recipientAddress || ''}</div></TableCell>
                          <TableCell><Badge className={`${STATUS_COLORS[item.status] || ''} text-[10px]`}>{item.status}</Badge></TableCell>
                          <TableCell className="hidden lg:table-cell">{item.prePaidBySwarm ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-[10px]">Swarm</Badge> : <Badge variant="outline" className="text-[10px]">Self</Badge>}</TableCell>
                        </TableRow>
                      ))}
                      {filteredProc.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No procurement items.</TableCell></TableRow>}
                    </TableBody></Table>
                  </ScrollArea>
                </CardContent></Card>
              </TabsContent>

              {/* ── SUB-TAB: PURCHASE ORDERS ── */}
              <TabsContent value="orders" className="space-y-6 mt-6">
                {/* Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    {(poData?.summary?.pendingApprovalCount ?? 0) > 0 && (
                      <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={handleBulkApprove}>
                        <ThumbsUp className="w-3.5 h-3.5" />Bulk Approve All Pending ({poData?.summary?.pendingApprovalCount})
                      </Button>
                    )}
                  </div>
                  <Select value={poFilter} onValueChange={setPoFilter}>
                    <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Filter status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="pending_approval">Pending Approval</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="ordered">Ordered</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* PO Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {poData && poData.orders
                    .filter(o => poFilter === 'all' || o.status === poFilter)
                    .map(po => (
                    <motion.div key={po.id} whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                      <Card className={`h-full flex flex-col ${po.status === 'rejected' ? 'border-red-200 dark:border-red-800' : po.status === 'pending_approval' ? 'border-amber-200 dark:border-amber-800' : ''}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="text-sm font-mono">{po.poNumber}</CardTitle>
                            <Badge className={`${STATUS_COLORS[po.status] || ''} text-[10px]`}>{po.status.replace(/_/g, ' ')}</Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <CardDescription className="text-xs truncate max-w-[180px]">{po.title || po.supplierName}</CardDescription>
                            <Badge variant="outline" className="text-[10px] capitalize shrink-0">{po.priority}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div className="text-muted-foreground">Supplier</div>
                            <div className="text-right font-medium truncate">{po.supplierName}</div>
                            <div className="text-muted-foreground">Line Items</div>
                            <div className="text-right font-medium">{po.lineItemCount}</div>
                            <div className="text-muted-foreground">Amount</div>
                            <div className="text-right font-mono font-medium">{fmt(po.totalAmount)}</div>
                            {po.submittedAt && <><div className="text-muted-foreground">Submitted</div><div className="text-right">{format(new Date(po.submittedAt), 'MMM d, yyyy')}</div></>}
                            {po.approvedAt && <><div className="text-muted-foreground">Approved</div><div className="text-right">{format(new Date(po.approvedAt), 'MMM d, yyyy')}</div></>}
                            {po.orderedAt && <><div className="text-muted-foreground">Ordered</div><div className="text-right">{format(new Date(po.orderedAt), 'MMM d, yyyy')}</div></>}
                            {po.completedAt && <><div className="text-muted-foreground">Completed</div><div className="text-right">{format(new Date(po.completedAt), 'MMM d, yyyy')}</div></>}
                            {po.approvedBy && <><div className="text-muted-foreground">Approved By</div><div className="text-right">{po.approvedBy}</div></>}
                            {po.rejectedBy && <><div className="text-muted-foreground">Rejected By</div><div className="text-right">{po.rejectedBy}</div></>}
                          </div>
                          {po.rejectionReason && (
                            <div className="mt-1 p-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                              <p className="text-xs text-red-700 dark:text-red-400 flex items-start gap-1.5"><XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{po.rejectionReason}</p>
                            </div>
                          )}
                          {po.notes && (
                            <p className="text-[10px] text-muted-foreground mt-1 italic">{po.notes}</p>
                          )}
                          {/* Action Buttons */}
                          <div className="mt-auto pt-2 flex flex-wrap gap-2">
                            {po.status === 'draft' && (
                              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handlePOAction(po.id, 'submit')}>
                                <Send className="w-3 h-3" />Submit for Approval
                              </Button>
                            )}
                            {po.status === 'pending_approval' && (
                              <>
                                <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handlePOAction(po.id, 'approve')}>
                                  <ThumbsUp className="w-3 h-3" />Approve
                                </Button>
                                <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => handlePOAction(po.id, 'reject', 'Rejected by reviewer')}>
                                  <ThumbsDown className="w-3 h-3" />Reject
                                </Button>
                              </>
                            )}
                            {po.status === 'approved' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => toast.info('Mark as ordered — use API to update status')}>
                                <Package className="w-3 h-3" />Mark Ordered
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                  {(!poData || (poData.orders.filter(o => poFilter === 'all' || o.status === poFilter).length === 0)) && (
                    <div className="col-span-full text-center py-12 text-muted-foreground">No purchase orders found.</div>
                  )}
                </div>
              </TabsContent>

              {/* ── SUB-TAB: SUPPLIERS ── */}
              <TabsContent value="suppliers" className="space-y-6 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {supplierData.map(supplier => {
                    const getCountryFlag = (name: string) => {
                      const n = name.toLowerCase()
                      if (n.includes('superfood') || n.includes('local') || n.includes('morocco')) return '🇲🇦'
                      if (n.includes('temu') || n.includes('aliexpress') || n.includes('ali')) return '🇨🇳'
                      if (n.includes('amazon')) return '🇺🇸'
                      return '🌍'
                    }
                    const flag = getCountryFlag(supplier.name)
                    return (
                      <motion.div key={supplier.id} whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }}>
                        <Card className={`h-full flex flex-col ${!supplier.isActive ? 'opacity-60' : ''}`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{flag}</span>
                                <div className="min-w-0">
                                  <CardTitle className="text-sm truncate">{supplier.name}</CardTitle>
                                  <CardDescription className="text-[10px] font-mono">{supplier.code}</CardDescription>
                                </div>
                              </div>
                              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${supplier.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            </div>
                          </CardHeader>
                          <CardContent className="flex-1 flex flex-col gap-3 text-xs">
                            {/* Details */}
                            <div className="space-y-1.5">
                              {supplier.country && <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span>{supplier.country}</span></div>}
                              {supplier.contactEmail && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="truncate">{supplier.contactEmail}</span></div>}
                              {supplier.website && <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><a href={supplier.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{supplier.website}</a></div>}
                              <div className="flex items-center gap-2"><CreditCard className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><Badge variant="outline" className="text-[10px]">{supplier.paymentTerms}</Badge></div>
                            </div>

                            <Separator />

                            {/* Metrics */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2 rounded-md bg-muted/50">
                                <p className="text-muted-foreground text-[10px]">Total Orders</p>
                                <p className="font-bold text-sm">{supplier.totalOrders}</p>
                              </div>
                              <div className="p-2 rounded-md bg-muted/50">
                                <p className="text-muted-foreground text-[10px]">Total Spend</p>
                                <p className="font-bold text-sm font-mono">{fmt(supplier.totalSpend)}</p>
                              </div>
                              <div className="p-2 rounded-md bg-muted/50">
                                <p className="text-muted-foreground text-[10px]">On-Time Rate</p>
                                <p className={`font-bold text-sm ${supplier.onTimeRate >= 90 ? 'text-emerald-600' : supplier.onTimeRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{supplier.onTimeRate.toFixed(1)}%</p>
                              </div>
                              <div className="p-2 rounded-md bg-muted/50">
                                <p className="text-muted-foreground text-[10px]">Defect Rate</p>
                                <p className={`font-bold text-sm ${supplier.defectRate <= 2 ? 'text-emerald-600' : supplier.defectRate <= 5 ? 'text-amber-600' : 'text-red-600'}`}>{supplier.defectRate.toFixed(1)}%</p>
                              </div>
                            </div>

                            {!supplier.isActive && (
                              <Badge variant="outline" className="text-red-500 border-red-300 dark:border-red-700 self-start text-[10px]">Inactive</Badge>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    )
                  })}
                  {supplierData.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground">No suppliers found.</div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/50 py-3 mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-muted-foreground">
          <span>Supply Chain Management — Younes Tsouli CIN:A337773</span>
          <span>All items pre-paid by Swarm · Recipients do not disburse</span>
        </div>
      </footer>
    </div>
    </TooltipProvider>
  )
}
