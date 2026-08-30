// ——— Pipeline Advancement Engine ———
// Moves procurement items through the pipeline with oracle proofs:
//   pending → ordered → shipped → in_transit → delivered → receipt_confirmed → settled
//
// Each transition generates an oracle proof (SHA-256 hash of the transition data)
// that is stored on the item and in the AuditLedger for tamper detection.
// ——————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'
import {
  payoutReleaseGate,
  type ShipmentEvidence,
  type ReceiptEvidence,
  type PurchaseOrderReference,
  type ScrapedTrackingPayload,
  gatewayHealthCheck,
  firstAvailableGateway,
  isSyntheticOracleHash as _isSyntheticOracleHash,
} from '@/lib/procurement/payment-gateway-router'
import { autodetectCarrier } from '@/lib/procurement/carrier-router'

export type PipelineStatus =
  | 'pending' | 'ordered' | 'shipped' | 'in_transit'
  | 'delivered' | 'receipt_confirmed' | 'settled' | 'cancelled'

/** Notes grow on every transition — bound them so rows stay readable. */
const NOTE_MAX = 4000
function appendNote(prev: string | null | undefined, add: string): string {
  const merged = `${prev ? `${prev} | ` : ''}${add}`.trim()
  return merged.length <= NOTE_MAX ? merged : `…${merged.slice(merged.length - NOTE_MAX)}`
}

/**
 * Build the 3-point guard's scraped payload from the shipment's stored carrier
 * events + carrier-reported weight. Terminal (destination) signal = LAST event
 * in chronological order (delivery scan), NOT the first (origin/pickup scan).
 */
function scrapedPayloadFromShipment(
  eventsJson: string | null | undefined,
  weightKg: number | null | undefined,
): ScrapedTrackingPayload {
  let events: Array<{ timestamp?: string; location?: string }> = []
  try {
    const parsed = JSON.parse(eventsJson || '[]')
    if (Array.isArray(parsed)) events = parsed as Array<{ timestamp?: string; location?: string }>
  } catch { /* unparseable events are not evidence */ }
  const sorted = events
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return {
    destination_city: last?.location,
    weight_kg: weightKg ?? undefined,
    shipped_at: first?.timestamp,
    delivered_at: last?.timestamp,
  }
}

export interface AdvanceResult {
  itemId: string
  itemName: string
  fromStatus: string
  toStatus: string
  oracleProof: string
  timestamp: string
}

export interface BulkAdvanceReport {
  timestamp: string
  advanced: AdvanceResult[]
  skipped: Array<{ itemId: string; itemName: string; reason: string }>
  errors: Array<{ itemId: string; itemName: string; error: string }>
  totalAdvanced: number
  totalSkipped: number
}

/**
 * Advance a single item to the next pipeline stage.
 * Returns the oracle proof for the transition.
 */
export async function advanceItem(
  itemId: string,
  targetStatus: PipelineStatus,
  metadata?: {
    carrier?: string
    trackingNumber?: string
    trackingUrl?: string
    proofHash?: string
    confirmedBy?: string
    notes?: string
    /** Carrier-scraped tracking payload (overrides the shipment's stored events). */
    scraped?: ScrapedTrackingPayload
  },
): Promise<AdvanceResult> {
  const item = await db.procurementItem.findUnique({ where: { id: itemId } })
  if (!item) throw new Error(`Item ${itemId} not found`)

  const validTransitions: Record<string, string[]> = {
    pending: ['ordered', 'cancelled'],
    ordered: ['shipped', 'cancelled'],
    shipped: ['in_transit', 'delivered', 'cancelled'],
    in_transit: ['delivered', 'cancelled'],
    delivered: ['receipt_confirmed', 'cancelled'],
    receipt_confirmed: ['settled'],
    settled: [],
    cancelled: [],
  }

  const allowed = validTransitions[item.status] || []
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Cannot transition '${item.name}' from '${item.status}' to '${targetStatus}'. Allowed: ${allowed.join(', ')}`)
  }

  const now = new Date()
  const updateData: Record<string, unknown> = { status: targetStatus }

  // Build oracle proof
  const oraclePayload = JSON.stringify({
    itemId: item.id,
    itemName: item.name,
    fromStatus: item.status,
    toStatus: targetStatus,
    quantity: item.quantity,
    unitPrice: item.unitPriceEst,
    recipient: item.recipientName,
    timestamp: now.toISOString(),
    metadata,
  })
  const oracleProof = sha256(oraclePayload)

  switch (targetStatus) {
    case 'ordered':
      updateData.orderedAt = item.orderedAt || now
      updateData.orderRef = metadata?.trackingNumber || metadata?.proofHash || item.orderRef
      break
    case 'shipped': {
      // FAIL-CLOSED: cannot mark shipped unless we know WHO is carrying it or
      // the tracking reference exists. No carrier + no tracking = no shipment,
      // ever. Prevents 48-fabricated-shipments-with-0-tracking class of bug.
      const hasCarrier = !!((metadata?.carrier || '').trim())
      const hasTracking = !!((metadata?.trackingNumber || '').trim())
      if (!hasCarrier && !hasTracking) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: Cannot transition '${item.name}' (id=${itemId}) from ordered → shipped without carrier AND/OR real trackingNumber. Carrier="${metadata?.carrier || ''}" tracking="${metadata?.trackingNumber || ''}". Policy: Morocco local-sourcing mandatory — suppliers jumia.ma / avito.ma / superfood.ma / marjanemall.ma / brico.ma / toko.ma / iris.ma provide real Poste Maroc / Amana tracking references; paste it here. If no shipment exists yet, stay status=ordered until carrier picks up.`
          ),
          { code: 'PROC_PIPELINE_NO_CARRIER', itemId, targetStatus }
        )
      }
      updateData.shippedAt = now
      updateData.supplierName = metadata?.carrier
        || item.supplierName
        // TRUTH-009 requires a carrier/supplier for shipped motion — when the
        // caller supplies only a tracking number, record the autodetected carrier.
        || (hasTracking ? autodetectCarrier((metadata?.trackingNumber as string).trim())?.carrier : undefined)
      const existingShipment = await db.shipment.findFirst({ where: { procurementItemId: item.id } })
      if (!existingShipment) {
        const trackingSet = hasTracking ? (metadata?.trackingNumber as string).trim() : null
        // shipmentNumber uniqueness: count()+1 races under concurrency — retry on
        // collision, then fall back to a timestamp discriminator (ULID-style tail).
        let created: Awaited<ReturnType<typeof db.shipment.create>> | null = null
        for (let attempt = 0; attempt < 4 && !created; attempt++) {
          const seq = (await db.shipment.count()) + 1 + attempt
          const suffix = attempt >= 2 ? `-${Date.now().toString(36)}` : ''
          try {
            created = await db.shipment.create({
              data: {
                shipmentNumber: `SHP-${String(new Date().getFullYear())}-${String(seq).padStart(4, '0')}${suffix}${trackingSet ? '' : '-LABEL'}`,
                procurementItemId: item.id,
                itemName: item.name,
                quantity: item.quantity,
                carrier: hasCarrier ? (metadata?.carrier as string).trim() : null,
                trackingNumber: trackingSet,
                trackingUrl: (metadata?.trackingUrl as string | undefined) || null,
                // Honest: label_created until carrier pick-up event confirmed. Never auto
                // in_transit without verified event (GooglePay-refund lost-proof pattern).
                status: trackingSet ? 'label_created' : 'pending',
                trackingVerified: false,
                destinationName: item.recipientName,
                destinationAddress: item.deliveryAddress || item.recipientAddress || 'Morocco',
                destinationCountry: 'Morocco',
                estimatedDelivery: new Date(Date.now() + 7 * 86400000),
                notes: metadata?.notes || null,
              },
            })
          } catch (e) {
            const code = (e as { code?: string }).code
            if (code !== 'P2002' || attempt === 3) throw e
          }
        }
      } else {
        const patch: Record<string, unknown> = { trackingVerified: false }
        if (hasCarrier && !existingShipment.carrier) patch.carrier = (metadata?.carrier as string).trim()
        if (hasTracking && !existingShipment.trackingNumber) patch.trackingNumber = (metadata?.trackingNumber as string).trim()
        if ((metadata?.trackingUrl as string | undefined) && !existingShipment.trackingUrl) patch.trackingUrl = metadata?.trackingUrl as string
        if (existingShipment.status === 'pending' && hasTracking) patch.status = 'label_created'
        if (Object.keys(patch).length > 0) {
          await db.shipment.update({ where: { id: existingShipment.id }, data: patch })
        }
      }
      break
    }
    case 'in_transit': {
      const shipment = await db.shipment.findFirst({ where: { procurementItemId: item.id } })
      if (!shipment) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: Cannot transition ${itemId} shipped → in_transit without a prior Shipment record (procurementItemId=${item.id}). First mark → shipped with real carrier/tracking.`
          ),
          { code: 'PROC_PIPELINE_NO_SHIPMENT', itemId }
        )
      }
      if (!shipment.trackingNumber || shipment.trackingNumber.trim().length < 3) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: Shipment ${shipment.id} (item ${itemId}) → in_transit requires non-empty real trackingNumber. Got: "${shipment.trackingNumber || ''}". Morocco carriers (Poste Maroc / Amana / Aramex / DHL) provide tracking references — paste the real one.`
          ),
          { code: 'PROC_PIPELINE_NO_TRACKING', itemId, shipmentId: shipment.id }
        )
      }
      await db.shipment.update({
        where: { id: shipment.id },
        data: {
          status: 'in_transit',
          // trackingVerified ONLY set true if a real tracked event exists (not
          // simply because user typed a tracking number string). Keeps false
          // until /api/carrier-tracking?action=track returns REAL events JSON.
          trackingVerified: shipment.trackingVerified || false,
          trackingVerifiedAt: shipment.trackingVerified ? shipment.trackingVerifiedAt : undefined,
        },
      })
      break
    }
    case 'delivered': {
      updateData.deliveredAt = now
      const delivShipment = await db.shipment.findFirst({ where: { procurementItemId: item.id } })
      if (delivShipment) {
        const hasRealProof = delivShipment.trackingVerified === true ||
          (!!delivShipment.events && delivShipment.events.trim().length > 50)
        await db.shipment.update({
          where: { id: delivShipment.id },
          data: {
            status: 'delivered',
            actualDelivery: now,
            // Only flip trackingVerified=true here if we have real events. Never
            // accept a bare string as proof of delivery.
            trackingVerified: delivShipment.trackingVerified || hasRealProof,
            trackingVerifiedAt: (delivShipment.trackingVerified || hasRealProof) ? (delivShipment.trackingVerifiedAt || now) : undefined,
          },
        })
      }
      break
    }
    case 'receipt_confirmed': {
      // SOVEREIGN-RULING: NO ORACLEPROOF FABRICATION OF deliveryProofHash!
      // deliveryProofHash must be an EXTERNALLY PROVIDED real hash of a
      // delivery sign-off / POD photo / Jumia/Amana delivered-scan upload.
      // No oracleProof fallback = no synthetic receipt, ever.
      const realProof = (metadata?.proofHash || '').trim()
      if (!realProof || realProof.length < 16) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} (${item.name}) → receipt_confirmed requires real EXTERNAL deliveryProofHash (POD photo hash, carrier scan hash, hand-signed receipt SHA). Length >= 16 chars. Got proofHash="${metadata?.proofHash || ''}" (length ${String(metadata?.proofHash || '').length}). Fallback to locally-computed oracleProof was REMOVED by GooglePay-refund anti-fabrication hardening 2026-08-29 sovereign ruling.`
          ),
          { code: 'PROC_PIPELINE_SYNTHETIC_PROOF_FORBIDDEN', itemId }
        )
      }
      const confirmedBy = ((metadata?.confirmedBy || '').trim())
      if (!confirmedBy) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: receipt_confirmed requires confirmedBy (real human name / admin). Got: "${metadata?.confirmedBy || ''}".`
          ),
          { code: 'PROC_PIPELINE_NO_CONFIRMER', itemId }
        )
      }
      updateData.receiptConfirmedAt = now
      updateData.receiptConfirmedBy = confirmedBy
      updateData.deliveryProofHash = realProof
      updateData.quantityReceived = metadata?.notes?.includes('partial')
        ? (item.quantityReceived ?? item.quantity)
        : item.quantity
      updateData.receiptCondition = 'good'
      updateData.receiptNotes = metadata?.notes || 'Owner-confirmed delivery; real proofHash stored.'
      updateData.receiptDiscrepancy = !!metadata?.notes?.includes('discrepancy')
      break
    }
    case 'settled': {
      // SOVEREIGN RULING triple check before marking a procurement item SETTLED:
      //   (A) deliveryProofHash present and not synthetic
      //   (B) receiptConfirmedAt populated
      //   (C) receiptConfirmedBy populated (a real human signed off)
      // ALL 3 required, no exceptions.
      //
      // PLUS the new 2026-08-30 unified payout-release gate:
      //   (D) Shipment.trackingVerified=true (real carrier public event detected)
      //   (E) Amana COD 24h dispute window elapsed OR buyer signed off
      //   (F) 3-point PO fraud guard (destination/weight/timeline) ALL PASS
      //   (G) At least one payment gateway (PayZone/YouCan Pay/CMI/Stripe/Chari/3PL)
      //       has API keys/balance configured (fail-closed until configured)
      if (!item.deliveryProofHash || item.deliveryProofHash.trim().length < 16) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} (${item.name}) → settled requires deliveryProofHash populated at receipt_confirmed step. Current deliveryProofHash="${item.deliveryProofHash || ''}". Run the receipt_confirmed transition first with real POD/human sign-off.`
          ),
          { code: 'PROC_PIPELINE_SETTLE_WITHOUT_PROOF', itemId }
        )
      }
      if (_isSyntheticOracleHash(item.deliveryProofHash)) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} (${item.name}) → settled deliveryProofHash is a locally-computed oracle SHA (bare 64 hex with no external anchor). REAL PROOF REQUIRED: POD/scan/carrier hash with prefix (pod:/scan:/AMANA-/POSTE-/JUMIA-), not synthetic.`
          ),
          { code: 'PROC_PIPELINE_SETTLE_SYNTHETIC_PROOF', itemId }
        )
      }
      if (!item.receiptConfirmedAt) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} → settled requires receiptConfirmedAt timestamp (must go through receipt_confirmed state with confirmer).`
          ),
          { code: 'PROC_PIPELINE_SETTLE_NO_RECEIPT_TS', itemId }
        )
      }
      if (!item.receiptConfirmedBy || item.receiptConfirmedBy.trim().length < 3) {
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} → settled requires receiptConfirmedBy = real human sign-off. Current: "${item.receiptConfirmedBy || ''}".`
          ),
          { code: 'PROC_PIPELINE_SETTLE_NO_CONFIRMER', itemId }
        )
      }
      // (D-G) Unified payout-release gate using the Shipment row (if any) + receipt + PO.
      // We attempt to load linked Shipment + PurchaseOrder for gate; not finding one →
      // gate uses empty payloads and still runs (fails HOLD on trackingVerified/COD as appropriate).
      let shipmentEvidence: ShipmentEvidence = {
        trackingVerified: false,
        carrier: (metadata?.carrier as string | undefined) || undefined,
        trackingNumber: (metadata?.trackingNumber as string | undefined) || undefined,
      }
      let scraped: ScrapedTrackingPayload | null = null
      let poRef: PurchaseOrderReference | null = null
      try {
        const shp = item.purchaseOrderId
          ? await db.shipment.findFirst({
              where: { OR: [{ procurementItemId: item.id }, { purchaseOrderId: item.purchaseOrderId }] },
              orderBy: { createdAt: 'desc' },
            })
          : await db.shipment.findFirst({ where: { procurementItemId: item.id }, orderBy: { createdAt: 'desc' } })
        if (shp) {
          shipmentEvidence = {
            trackingVerified: !!shp.trackingVerified,
            trackingVerifiedAt: shp.trackingVerifiedAt ?? undefined,
            actualDelivery: shp.actualDelivery ?? undefined,
            status: shp.status ?? undefined,
            carrier: shp.carrier ?? (metadata?.carrier as string | undefined),
            trackingNumber: shp.trackingNumber ?? (metadata?.trackingNumber as string | undefined),
          }
          // Default scraped payload: the shipment's own stored carrier events +
          // carrier-reported weight. metadata.scraped (explicit) overrides below.
          scraped = scrapedPayloadFromShipment(shp.events, shp.weightKg)
          if (shp.trackingNumber) {
            const probe = autodetectCarrier(shp.trackingNumber)
            if (probe) {
              shipmentEvidence.carrier = probe.carrier
            }
          }
        }
      } catch (_e) { /* swallow ORM misalignment; gate runs below and fails CLOSED on missing evidence */ }
      if (metadata && metadata.scraped && typeof metadata.scraped === 'object') {
        scraped = metadata.scraped
      }
      // 3-point guard order context lives on ProcurementItem (deliveryCity /
      // expectedMinWeightKg — migration 20260830000100). The old (po as any).deliveryCity
      // reads on PurchaseOrder were ALWAYS undefined (that table has no such columns) —
      // dead checks removed; PO row only contributes its authoritative createdAt.
      poRef = {
        id: item.id,
        delivery_city: item.deliveryCity ?? undefined,
        expected_min_weight_kg: item.expectedMinWeightKg ?? undefined,
        created_at: item.createdAt,
        items_total_qty: item.quantity ?? undefined,
      }
      if (item.purchaseOrderId) {
        try {
          const po = await db.purchaseOrder.findUnique({ where: { id: item.purchaseOrderId } })
          if (po) {
            poRef = {
              ...poRef,
              id: po.id,
              created_at: po.createdAt ?? item.createdAt,
              hub_name: po.supplierName,
            }
          }
        } catch (_e) { /* item-level context remains authoritative */ }
      }
      const receiptEvidence: ReceiptEvidence = {
        receiptConfirmedBy: item.receiptConfirmedBy,
        receiptConfirmedAt: item.receiptConfirmedAt,
        receiptDeliveryProofHash: item.deliveryProofHash,
        quantityReceived: item.quantityReceived ?? undefined,
      }
      const gate = payoutReleaseGate(
        shipmentEvidence,
        receiptEvidence,
        scraped,
        poRef,
        typeof process !== 'undefined' ? process.env : undefined,
        {
          requireHumanSignOff: true,
          requireQuantityMatch: true,
          totalOrderedQty: item.quantity ?? undefined,
        },
      )
      if (!gate.release) {
        const gwSummary = gatewayHealthCheck()
          .map((g) => `${g.name}:${g.available ? 'READY' : 'UNKEYED/' + g.reason.split('\n')[0].slice(0, 80)}`)
          .join('; ')
        throw Object.assign(
          new Error(
            `PROC-PIPELINE-FAILCLOSED: ProcurementItem ${itemId} (${item.name}) → settled BLOCKED by unified payout-release gate. Holds=[${gate.holdReasons.join(', ')}]. ${gate.holdDescriptions.map((d, i) => `(${i + 1}) ${d}`).join(' ')} [GATEWAY STATUS: ${gwSummary}] [ADVICE: ${gate.paymentMethodAdvice}] Run the gate again once all boxes ticked; NO AUTO-ADVANCE past ordered without real proof per sovereign ruling 2026-08-29.`
          ),
          {
            code: 'PROC_PIPELINE_SETTLE_PAYOUT_GATE_HELD',
            itemId,
            gate,
            availableGateway: firstAvailableGateway()?.name ?? null,
          }
        )
      }
      updateData.notes = appendNote(item.notes, `[SETTLED] Pipeline settlement at ${new Date().toISOString()} (proof verified: ${item.deliveryProofHash.slice(0, 16)}… | payout gate PASS at ${gate.releaseAt?.toISOString() ?? 'now'}).`)
      break
    }
  }

  // Store oracle proof in the item notes
  updateData.notes = appendNote(updateData.notes ?? item.notes, `[ORACLE:${item.status}->${targetStatus}] proof:${oracleProof.slice(0, 16)}...`)

  const updated = await db.procurementItem.update({ where: { id: itemId }, data: updateData })

  // Write AuditLedger entry. The previousHash chain is serialized with a
  // transaction-scoped Postgres advisory lock — concurrent writes previously
  // read the same lastAudit row and forked the chain.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('audit_ledger_chain'))`
    const lastAudit = await tx.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
    await tx.auditLedger.create({
      data: {
        entityType: 'procurement_item',
        entityId: itemId,
        action: `pipeline_${targetStatus}`,
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: oracleProof,
        proofHash: oracleProof,
        performedBy: 'pipeline-engine',
        metadata: JSON.stringify({
          itemName: item.name,
          fromStatus: item.status,
          toStatus: targetStatus,
          recipient: item.recipientName,
          quantity: item.quantity,
          unitPrice: item.unitPriceEst,
          oracleProof,
        }),
      },
    })
  })

  return {
    itemId: item.id,
    itemName: item.name,
    fromStatus: item.status,
    toStatus: targetStatus,
    oracleProof,
    timestamp: now.toISOString(),
  }
}

/**
 * Bulk advance all eligible items to their next pipeline stage.
 *
 * FAIL-CLOSED POLICY (GooglePay-refund anti-phantom hardening 2026-08-29):
 *   — Without explicit `metadata` containing proof for the target stage, this
 *     function NEVER auto-advances past `ordered`. The old bug (175 items
 *     marched to `settled` without a single carrier, tracking number, POD
 *     scan, or human sign-off) cannot re-occur because each per-state
 *     transition in advanceItem() now THROWS when proof is absent.
 *   — Only `pending → ordered` is an allowed "auto" transition with no proof
 *     (it just means the PO was submitted, which has no external dependency
 *     other than the supplier order reference being recorded if present).
 *   — If you DO want to bulk-advance past ordered, CALLER must supply real
 *     metadata with carrier/trackingNumber/POD proofHash + confirmedBy.
 */
export async function bulkAdvance(
  targetStatus?: PipelineStatus,
  metadata?: {
    carrier?: string
    trackingNumber?: string
    trackingUrl?: string
    proofHash?: string
    confirmedBy?: string
    notes?: string
    scraped?: ScrapedTrackingPayload
  },
): Promise<BulkAdvanceReport> {
  const report: BulkAdvanceReport = {
    timestamp: new Date().toISOString(),
    advanced: [],
    skipped: [],
    errors: [],
    totalAdvanced: 0,
    totalSkipped: 0,
  }

  const hasProofForShipping =
    !!((metadata?.carrier || '').trim()) || !!((metadata?.trackingNumber || '').trim())
  const hasProofForReceipt =
    !!((metadata?.proofHash || '').trim()) && !!((metadata?.confirmedBy || '').trim())

  const items = await db.procurementItem.findMany({
    where: { status: { notIn: ['settled', 'cancelled'] } },
  })

  // Next state map — HONEST: only the ones provably safe without external proof.
  // Any caller-supplied metadata overrides into higher states with real proof.
  const nextStatusNoProof: Record<string, PipelineStatus> = {
    pending: 'ordered',
    // ordered → shipped removed (needs carrier/tracking proof)
    // shipped → in_transit removed (needs shipment row + tracking row)
    // in_transit → delivered removed (needs trackingVerified / events proof)
    // delivered → receipt_confirmed removed (needs proofHash + confirmedBy human)
    // receipt_confirmed → settled removed (needs triple proof chain)
  }

  for (const item of items) {
    let goal = targetStatus || nextStatusNoProof[item.status]
    // If caller gave shipping proof, allow ordered→shipped auto
    if (!goal && hasProofForShipping && item.status === 'ordered') {
      goal = 'shipped'
    }
    // If caller gave receipt proof, allow delivered→receipt_confirmed
    if (!goal && hasProofForReceipt && item.status === 'delivered') {
      goal = 'receipt_confirmed'
    }
    if (!goal) {
      report.skipped.push({
        itemId: item.id,
        itemName: item.name,
        reason: `No auto-advance defined for status '${item.status}' without external proof metadata. Transition manually via advanceItem() with real carrier / tracking / proofHash.`,
      })
      report.totalSkipped++
      continue
    }

    try {
      const result = await advanceItem(item.id, goal, metadata)
      report.advanced.push(result)
      report.totalAdvanced++
    } catch (err) {
      report.errors.push({
        itemId: item.id,
        itemName: item.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return report
}
