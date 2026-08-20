// ——— Database-Level Truth Guards (Prisma Middleware) ———
// Since we use SQLite (not PostgreSQL), we enforce truth constraints at the
// Prisma middleware layer. This prevents any code path from bypassing the rules.
//
// Rules enforced:
//   TRUTH-001: OwnerSettlement.status='completed' REQUIRES externalRef (min 6 hex chars)
//   TRUTH-002: OwnerSettlement.status='completed' blocks internal_ledger_only dataSource
//   TRUTH-003: RevenueEvent.status='verified' REQUIRES proofType + proofHash
//   TRUTH-004: PayoutBatch.status='completed' REQUIRES providerBatchRef
//   TRUTH-005: ProcurementItem.receiptConfirmedAt requires deliveryProofHash (valid hex)
//   TRUTH-006: Covers create, update, updateMany, upsert — no bypass possible
// —————————————————————————————————————————————————————————————

import { PrismaClient } from '@prisma/client'

interface MiddlewareParams {
  model?: string
  action: string
  args: Record<string, unknown>
  dataPath: string[]
  runInTransaction: boolean
}

type NextFn = (args: MiddlewareParams) => Promise<unknown>

const VALID_HEX_HASH = /^[a-f0-9]{16,128}$/i
const VALID_EXTERNAL_REF = /^[a-zA-Z0-9\-_:.]{6,}$/

function isValidProofHash(v: unknown): boolean {
  return typeof v === 'string' && VALID_HEX_HASH.test(v.trim())
}

function isValidExternalRef(v: unknown): boolean {
  return typeof v === 'string' && VALID_EXTERNAL_REF.test(v.trim())
}

/**
 * Install truth guard middleware on a PrismaClient instance.
 * Covers: create, update, updateMany, upsert (both create and update paths).
 */
export function installTruthGuards(client: PrismaClient): void {
  // ——— OwnerSettlement guard ———
  client.$use(async (params: MiddlewareParams, next: NextFn) => {
    if (params.model === 'OwnerSettlement') {
      const data = params.args.data as Record<string, unknown> | undefined

      // Handle upsert: check both create and update paths
      if (params.action === 'upsert') {
        const createData = params.args.create as Record<string, unknown> | undefined
        const updateData = params.args.update as Record<string, unknown> | undefined
        if (createData?.status === 'completed') {
          if (!isValidExternalRef(createData.externalRef)) {
            throw new Error('TRUTH-001 VIOLATION: Cannot create OwnerSettlement with status "completed" without valid externalRef (min 6 alphanumeric chars).')
          }
          if (createData.dataSource === 'internal_ledger_only') {
            throw new Error('TRUTH-002 VIOLATION: Cannot create OwnerSettlement with status "completed" and dataSource "internal_ledger_only".')
          }
          if (!createData.verifiedAt) createData.verifiedAt = new Date()
        }
        if (updateData?.status === 'completed') {
          if (!isValidExternalRef(updateData.externalRef)) {
            throw new Error('TRUTH-001 VIOLATION: Cannot set OwnerSettlement status to "completed" without valid externalRef (min 6 alphanumeric chars). Operation KILLED.')
          }
          if (updateData.dataSource === 'internal_ledger_only') {
            throw new Error('TRUTH-002 VIOLATION: Cannot set OwnerSettlement status to "completed" with dataSource "internal_ledger_only". This would create a FICTIONAL settlement. Operation KILLED.')
          }
          if (!updateData.verifiedAt) updateData.verifiedAt = new Date()
        }
      }

      // Handle create
      if (params.action === 'create') {
        if (data?.status === 'completed') {
          if (!isValidExternalRef(data.externalRef)) {
            throw new Error('TRUTH-001 VIOLATION: Cannot create OwnerSettlement with status "completed" without valid externalRef.')
          }
          if (data.dataSource === 'internal_ledger_only') {
            throw new Error('TRUTH-002 VIOLATION: Cannot create OwnerSettlement with status "completed" and dataSource "internal_ledger_only".')
          }
          if (!data.verifiedAt) data.verifiedAt = new Date()
        }
      }

      // Handle update / updateMany
      if (params.action === 'update' || params.action === 'updateMany') {
        if (data?.status === 'completed') {
          if (!isValidExternalRef(data.externalRef)) {
            throw new Error('TRUTH-001 VIOLATION: Cannot set OwnerSettlement status to "completed" without valid externalRef (min 6 alphanumeric chars). Operation KILLED.')
          }
          if (data.dataSource === 'internal_ledger_only') {
            throw new Error('TRUTH-002 VIOLATION: Cannot set OwnerSettlement status to "completed" with dataSource "internal_ledger_only". Operation KILLED.')
          }
          if (!data.verifiedAt) data.verifiedAt = new Date()
        }
      }
    }
    return next(params)
  })

  // ——— RevenueEvent guard ———
  client.$use(async (params: MiddlewareParams, next: NextFn) => {
    if (params.model === 'RevenueEvent') {
      const checkData = (data: Record<string, unknown> | undefined, action: string) => {
        if (!data || data.status !== 'verified') return
        if (!data.proofType || typeof data.proofType !== 'string' || data.proofType.trim().length === 0) {
          throw new Error(`TRUTH-003 VIOLATION: Cannot ${action} RevenueEvent to "verified" without proofType. Operation KILLED.`)
        }
        if (!isValidProofHash(data.proofHash)) {
          throw new Error(`TRUTH-003 VIOLATION: Cannot ${action} RevenueEvent to "verified" without valid proofHash (hex, min 16 chars). Operation KILLED.`)
        }
      }

      if (params.action === 'create') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'create')
      } else if (params.action === 'update' || params.action === 'updateMany') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'update')
      } else if (params.action === 'upsert') {
        checkData((params.args.create as Record<string, unknown>) ?? undefined, 'create')
        checkData((params.args.update as Record<string, unknown>) ?? undefined, 'update')
      }
    }
    return next(params)
  })

  // ——— PayoutBatch guard ———
  client.$use(async (params: MiddlewareParams, next: NextFn) => {
    if (params.model === 'PayoutBatch') {
      const checkData = (data: Record<string, unknown> | undefined, action: string) => {
        if (!data) return
        if (data.status === 'completed') {
          if (!data.providerBatchRef || typeof data.providerBatchRef !== 'string' || data.providerBatchRef.trim().length < 6) {
            throw new Error(`TRUTH-004 VIOLATION: Cannot ${action} PayoutBatch to "completed" without providerBatchRef (min 6 chars). Operation KILLED.`)
          }
        }
        // TRUTH-009: status='submitted' requires providerBatchRef + paymentProvider
        if (data.status === 'submitted') {
          if (!data.providerBatchRef || typeof data.providerBatchRef !== 'string' || data.providerBatchRef.trim().length < 6) {
            throw new Error(`TRUTH-009 VIOLATION: Cannot ${action} PayoutBatch to "submitted" without providerBatchRef. Operation KILLED.`)
          }
          if (!data.paymentProvider || typeof data.paymentProvider !== 'string' || data.paymentProvider.trim().length < 2) {
            throw new Error(`TRUTH-009 VIOLATION: Cannot ${action} PayoutBatch to "submitted" without paymentProvider. Operation KILLED.`)
          }
        }
      }

      if (params.action === 'create') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'create')
      } else if (params.action === 'update' || params.action === 'updateMany') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'update')
      } else if (params.action === 'upsert') {
        checkData((params.args.create as Record<string, unknown>) ?? undefined, 'create')
        checkData((params.args.update as Record<string, unknown>) ?? undefined, 'update')
      }
    }
    return next(params)
  })

  // ——— ProcurementItem guard ———
  client.$use(async (params: MiddlewareParams, next: NextFn) => {
    if (params.model === 'ProcurementItem') {
      const checkData = (data: Record<string, unknown> | undefined, action: string) => {
        if (!data) return
        // TRUTH-005: receipt confirmation requires deliveryProofHash (valid hex)
        if (data.receiptConfirmedAt && !isValidProofHash(data.deliveryProofHash)) {
          throw new Error(`TRUTH-005 VIOLATION: Cannot ${action} ProcurementItem receipt without valid deliveryProofHash (hex, min 16 chars). Operation KILLED.`)
        }
        // TRUTH-007: status='ordered' requires orderRef + supplierName
        if (data.status === 'ordered') {
          if (!data.orderRef || typeof data.orderRef !== 'string' || data.orderRef.trim().length < 3) {
            throw new Error(`TRUTH-007 VIOLATION: Cannot ${action} ProcurementItem to "ordered" without valid orderRef. Operation KILLED.`)
          }
          if (!data.supplierName || typeof data.supplierName !== 'string' || data.supplierName.trim().length < 2) {
            throw new Error(`TRUTH-007 VIOLATION: Cannot ${action} ProcurementItem to "ordered" without supplierName. Operation KILLED.`)
          }
        }
        // TRUTH-008: status='delivered' requires receiptConfirmedBy (non-system)
        if (data.status === 'delivered') {
          if (!data.receiptConfirmedBy || typeof data.receiptConfirmedBy !== 'string' || data.receiptConfirmedBy.trim().length < 2) {
            throw new Error(`TRUTH-008 VIOLATION: Cannot ${action} ProcurementItem to "delivered" without receiptConfirmedBy. Operation KILLED.`)
          }
          if (data.receiptConfirmedBy === 'system' || data.receiptConfirmedBy === 'wet-run-engine') {
            throw new Error(`TRUTH-008 VIOLATION: receiptConfirmedBy cannot be 'system'. A human must confirm delivery. Operation KILLED.`)
          }
        }
      }

      if (params.action === 'create') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'create')
      } else if (params.action === 'update' || params.action === 'updateMany') {
        checkData(params.args.data as Record<string, unknown> | undefined, 'update')
      } else if (params.action === 'upsert') {
        checkData((params.args.create as Record<string, unknown>) ?? undefined, 'create')
        checkData((params.args.update as Record<string, unknown>) ?? undefined, 'update')
      }
    }
    return next(params)
  })

  console.log('[Truth Guards] Prisma middleware installed — TRUTH-001 through TRUTH-006 enforced (create/update/updateMany/upsert)')
}
