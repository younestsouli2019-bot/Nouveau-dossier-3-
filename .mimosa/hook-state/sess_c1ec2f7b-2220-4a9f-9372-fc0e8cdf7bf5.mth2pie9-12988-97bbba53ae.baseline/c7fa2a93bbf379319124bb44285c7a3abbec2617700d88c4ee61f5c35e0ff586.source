'use client'

import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type OwnerAccountsTabProps = {
  initialAccounts?: any[]
  initialSummary?: any
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank_wire: 'Bank Wire',
  l2_crypto: 'L2 Crypto',
  paypal: 'PayPal',
  wise: 'Wise',
  payoneer: 'Payoneer',
  internal_pool: 'Internal Pool',
}

function formatCurrency(value: number | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value ?? 0)
}

function getAccountIdentifier(account: any): string {
  switch (account?.accountType) {
    case 'bank_wire':
      return account.accountNumberLast
        ? `•••• ${account.accountNumberLast}`
        : account.accountNumber || '—'
    case 'l2_crypto':
      return account.walletAddressShort || '—'
    case 'paypal':
      return account.paypalEmail || '—'
    case 'wise':
      return account.wiseEmail || '—'
    case 'payoneer':
      return account.payoneerId || '—'
    default:
      return '—'
  }
}

function getTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] || type
}

export function OwnerAccountsTab({ initialAccounts, initialSummary }: OwnerAccountsTabProps) {
  const accounts = React.useMemo(() => initialAccounts ?? [], [initialAccounts])
  const summary = initialSummary

  const totalReceived = summary?.totalReceived ?? 0
  const totalSent = summary?.totalSent ?? 0
  const activeCount = summary?.activeCount ?? accounts.filter((a) => a.isActive).length
  const totalCount = summary?.total ?? accounts.length

  const stats = [
    { label: 'Total Accounts', value: String(totalCount) },
    { label: 'Active', value: String(activeCount) },
    { label: 'Total Received', value: formatCurrency(totalReceived) },
    { label: 'Total Sent', value: formatCurrency(totalSent) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent className="sr-only" />
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Owner Accounts</CardTitle>
          <CardDescription>
            Bank, crypto and wallet accounts used for owner payouts and settlements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Identifier / IBAN</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No owner accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {account.currency} · {account.txCount ?? 0} tx
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getTypeLabel(account.accountType)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {getAccountIdentifier(account)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {account.bankName || account.network || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(account.totalReceived, account.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(account.totalSent, account.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={account.isActive ? 'default' : 'destructive'}>
                          {account.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        {account.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default OwnerAccountsTab
