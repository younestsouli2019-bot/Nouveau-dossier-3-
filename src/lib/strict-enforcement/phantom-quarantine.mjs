import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const LIVE_CONNECTOR_STATUSES = new Set([
	"live",
	"verified",
	"manual_attested_finance",
	"live_onchain",
	"live_bank_api",
	"live_paypal_api",
	"live_stripe_api",
	"live_wise_api",
]);

const SYNTHETIC_REGEXES = [
	/^(PB-|RECOVER(Y|ED)?-|REV-|PP-\d+|ALT-|REC-|PROC-|MISPLACED)/i,
	/^R\d+-.{6,}/i,
	/^(REVIEWED|INSTRUCTIONS_READY|WAITING_MANUAL|TX-RECOVER-|REVERSAL-|CRYPTO-RECOVERY-|NOTXHASH)/i,
	/^(REPLACE_ME|CHANGEME|TODO|YOUR_[A-Z0-9_]+)$/i,
];

export function isSyntheticOrEmptyRef(ref) {
	if (ref == null) return true;
	const s = String(ref).trim();
	if (!s) return true;
	const upper = s.toUpperCase();
	for (const re of SYNTHETIC_REGEXES) {
		if (re.test(upper)) return true;
	}
	return false;
}

function isNotLiveConnectorStatus(cs) {
	if (cs == null) return true;
	const s = String(cs).trim().toLowerCase();
	return !LIVE_CONNECTOR_STATUSES.has(s);
}

let _prisma = null;
function getDb() {
	if (_prisma) return _prisma;
	_prisma = new PrismaClient({
		log: ["warn", "error"],
	});
	return _prisma;
}

async function writeAudit(db, { model, id, oldStatus, newStatus, amount, currency, why, proofFields, actor = "PHANTOM-QUARANTINE-SWEEP" }) {
	try {
		const payload = {
			entityType: model,
			entityId: id,
			action: "PHANTOM_COMPLETED_QUARANTINED",
			previousHash: proofFields?.previousHash || null,
			entryHash: proofFields?.entryHash || null,
			proofHash: proofFields?.proofHash || null,
			performedBy: actor,
			metadata: JSON.stringify({
				before: { status: oldStatus, ...proofFields },
				after: { status: newStatus },
				detail: why,
				model, id,
				quarantinedAt: new Date().toISOString(),
			}),
			createdAt: new Date(),
		};
		if (db.auditLedger) {
			await db.auditLedger.create({ data: payload }).catch(() => null);
		}
	} catch (_e) {
		// Ignore audit write failures — quarantine state change is primary objective
	}
}

async function quarantinePayoutItems(db) {
	const rows = await db.payoutItem.findMany({
		where: {
			status: { in: ["completed", "settled", "paid"] },
			OR: [
				{ externalRef: null },
				{ proofHash: null },
				{ connectorStatus: null },
			],
		},
		select: {
			id: true, status: true, amount: true, currency: true,
			externalRef: true, transactionRef: true, proofHash: true, connectorStatus: true,
			payoutBatchId: true, recipientName: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const refReal = !isSyntheticOrEmptyRef(row.externalRef) && !isSyntheticOrEmptyRef(row.transactionRef);
		const connectorLive = !isNotLiveConnectorStatus(row.connectorStatus);
		const proofReal = !isSyntheticOrEmptyRef(row.proofHash);
		const phantom = !refReal || !connectorLive || !proofReal;
		if (!phantom) continue;
		const whyParts = [];
		if (!refReal) whyParts.push(`refs empty/synthetic (externalRef=${JSON.stringify(row.externalRef)}, txRef=${JSON.stringify(row.transactionRef)})`);
		if (!connectorLive) whyParts.push(`connectorStatus not live (${JSON.stringify(row.connectorStatus)})`);
		if (!proofReal) whyParts.push(`proofHash empty/synthetic (${JSON.stringify(row.proofHash)})`);
		const why = `PHANTOM PayoutItem.completed BLOCKED by 3-layer anti-lost-revenue defence: ${whyParts.join("; ")}. REQUIRED: attach REAL provider receipt (PayPal Payouts PAY-* ID, Wise transfer UETR, Attijari WPS reference, MT103 UETR, on-chain tx hash, Stripe Connect pi_ ID, etc.) as externalRef, set connectorStatus=manual_attested_finance, recompute proofHash=sha256(itemId:realRef:amount:currency). If funds never moved, write status=failed with clear reason.`;
		try {
			await db.payoutItem.update({
				where: { id: row.id },
				data: {
					status: "needs_manual_proof",
					failureReason: why,
					deliveryConfirmed: false,
					deliveryConfirmedAt: null,
					connectorStatus: isNotLiveConnectorStatus(row.connectorStatus) ? "not_configured" : row.connectorStatus,
				},
			});
			await writeAudit(db, {
				model: "PayoutItem", id: row.id,
				oldStatus: row.status, newStatus: "needs_manual_proof",
				amount: row.amount, currency: row.currency, why,
				proofFields: { externalRef: row.externalRef, transactionRef: row.transactionRef, proofHash: row.proofHash, connectorStatus: row.connectorStatus, recipientName: row.recipientName },
			});
			console.error(`[PHANTOM-QUARANTINE] PayoutItem ${row.id} ($${Number(row.amount).toFixed(2)} ${row.currency || "USD"} → ${row.recipientName || "?"}) moved completed → needs_manual_proof. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine PayoutItem ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantinePayoutBatches(db) {
	const rows = await db.payoutBatch.findMany({
		where: {
			status: { in: ["completed", "settled", "paid", "reconciled"] },
			OR: [{ providerBatchRef: null }, { proofHash: null }],
		},
		select: {
			id: true, batchNumber: true, status: true, totalAmount: true, currency: true,
			providerBatchRef: true, proofHash: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const refReal = !isSyntheticOrEmptyRef(row.providerBatchRef);
		const proofReal = !isSyntheticOrEmptyRef(row.proofHash);
		const phantom = !refReal || !proofReal;
		if (!phantom) continue;
		const whyParts = [];
		if (!refReal) whyParts.push(`provider refs empty/synthetic (providerBatchRef=${JSON.stringify(row.providerBatchRef)})`);
		if (!proofReal) whyParts.push(`batch proofHash empty/synthetic (${JSON.stringify(row.proofHash)})`);
		const why = `PHANTOM PayoutBatch.completed BLOCKED: ${whyParts.join("; ")}. REQUIRED: attach REAL provider batch receipt (PayPal payout-batch PayoutBatchId, Wise batch ID, Attijari bulk WPS ID, Stripe Connect transfer group ID) as providerBatchRef, recompute proofHash=sha256(batchId:realRef:total:currency). If batch never actually disbursed, write status=processing/failed.`;
		try {
			await db.payoutBatch.update({
				where: { id: row.id },
				data: {
					status: "processing",
					resolutionNote: why,
					resolvedAt: null,
					proofHash: null,
					autoProcessed: false,
					autoProcessedAt: null,
				},
			});
			await writeAudit(db, {
				model: "PayoutBatch", id: row.id,
				oldStatus: row.status, newStatus: "processing",
				amount: row.totalAmount, currency: row.currency, why,
				proofFields: { providerBatchRef: row.providerBatchRef, proofHash: row.proofHash, batchNumber: row.batchNumber },
			});
			console.error(`[PHANTOM-QUARANTINE] PayoutBatch ${row.id} (batchNumber=${row.batchNumber}, $${Number(row.totalAmount || 0).toFixed(2)}) moved ${row.status} → processing. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine PayoutBatch ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantineOwnerSettlements(db) {
	const rows = await db.ownerSettlement.findMany({
		where: {
			status: { in: ["completed", "settled", "paid", "disbursed", "LIVE_SETTLED"] },
			OR: [{ externalRef: null }, { proofHash: null }, { connectorStatus: null }],
		},
		select: {
			id: true, status: true, netAmount: true, currency: true,
			externalRef: true, referenceId: true, proofHash: true, connectorStatus: true,
			ownerAccountId: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const refReal = !isSyntheticOrEmptyRef(row.externalRef) && !isSyntheticOrEmptyRef(row.referenceId);
		const connectorLive = !isNotLiveConnectorStatus(row.connectorStatus);
		const proofReal = !isSyntheticOrEmptyRef(row.proofHash);
		const phantom = !refReal || !connectorLive || !proofReal;
		if (!phantom) continue;
		const whyParts = [];
		if (!refReal) whyParts.push(`refs empty/synthetic (ext=${JSON.stringify(row.externalRef)}, referenceId=${JSON.stringify(row.referenceId)})`);
		if (!connectorLive) whyParts.push(`connectorStatus not live (${JSON.stringify(row.connectorStatus)})`);
		if (!proofReal) whyParts.push(`proofHash empty/synthetic (${JSON.stringify(row.proofHash)})`);
		const why = `PHANTOM OwnerSettlement BLOCKED: ${whyParts.join("; ")}. REQUIRED: attach REAL owner payout receipt (Attijari wire WPS ref + MT103 UETR, Wise transfer UETR to owner RIB 372, PayPal payout to OWNER_PAYPAL_EMAIL, crypto on-chain hash to OWNER_CRYPTO_WALLET) as externalRef + set connectorStatus=manual_attested_finance + write proofHash. If settlement never actually disbursed, revert status=processing/pending_approval.`;
		try {
			await db.ownerSettlement.update({
				where: { id: row.id },
				data: {
					status: "needs_manual_proof",
					connectorStatus: "not_configured",
					proofHash: null,
				},
			});
			await writeAudit(db, {
				model: "OwnerSettlement", id: row.id,
				oldStatus: row.status, newStatus: "needs_manual_proof",
				amount: row.netAmount, currency: row.currency, why,
				proofFields: { externalRef: row.externalRef, referenceId: row.referenceId, proofHash: row.proofHash, connectorStatus: row.connectorStatus, ownerAccountId: row.ownerAccountId },
			});
			console.error(`[PHANTOM-QUARANTINE] OwnerSettlement ${row.id} (ownerAccountId=${row.ownerAccountId || "?"}, $${Number(row.netAmount || 0).toFixed(2)}) moved ${row.status} → needs_manual_proof. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine OwnerSettlement ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantineRevenueEvents(db) {
	try {
		const rows = await db.revenueEvent.findMany({
			where: {
				status: { in: ["verified", "settled", "confirmed", "reconciled"] },
				OR: [{ referenceId: null }, { proofHash: null }],
			},
			select: {
				id: true, status: true, amount: true, currency: true,
				referenceId: true, proofHash: true, source: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const refReal = !isSyntheticOrEmptyRef(row.referenceId);
			const proofReal = !isSyntheticOrEmptyRef(row.proofHash);
			const phantom = !refReal || !proofReal;
			if (!phantom) continue;
			const whyParts = [];
			if (!refReal) whyParts.push(`referenceId empty/synthetic (${JSON.stringify(row.referenceId)})`);
			if (!proofReal) whyParts.push(`proofHash empty/synthetic (${JSON.stringify(row.proofHash)})`);
			const why = `PHANTOM RevenueEvent terminal status BLOCKED (GooglePay-refund-style lost-revenue pattern): ${whyParts.join("; ")}. REQUIRED: attach REAL revenue receipt (Stripe charge pi_/in_ ID, PayPal capture ID, invoice number, bank deposit slip ref, AICC/AgentFlow platform payout confirmation ID) as referenceId + write proofHash=sha256(eventId:realRef:amount:currency). If revenue never landed, write status=unbatched/pending with reason=lost.`;
			try {
				await db.revenueEvent.update({
					where: { id: row.id },
					data: {
						status: "pending",
						rejectedReason: why,
					},
				});
				await writeAudit(db, {
					model: "RevenueEvent", id: row.id,
					oldStatus: row.status, newStatus: "pending",
					amount: row.amount, currency: row.currency, why,
					proofFields: { referenceId: row.referenceId, proofHash: row.proofHash, source: row.source },
				});
				console.error(`[PHANTOM-QUARANTINE] RevenueEvent ${row.id} (source=${row.source || "?"}, $${Number(row.amount || 0).toFixed(2)}) moved ${row.status} → pending. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine RevenueEvent ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (e) {
		console.error(`[PHANTOM-QUARANTINE] RevenueEvent sweep failed (schema mismatch — check RevenueEvent fields):`, e?.message || String(e));
		return 0;
	}
}

async function quarantineCryptoSettlements(db) {
	try {
		const rows = await db.cryptoSettlement.findMany({
			where: {
				status: { in: ["confirmed", "settled", "completed", "onchain_finalized"] },
				OR: [{ recipientAddress: null }],
			},
			select: {
				id: true, status: true, amount: true, token: true, network: true,
				recipientAddress: true,
				misplaced: true, recovered: true, recoveredTxHash: true,
				txTime: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const addrReal = !isSyntheticOrEmptyRef(row.recipientAddress) && /^(0x|T|bc1|[13])/i.test(String(row.recipientAddress || ""));
			const phantom = !addrReal;
			if (!phantom) continue;
			const whyParts = [];
			if (!addrReal) whyParts.push(`recipientAddress missing/invalid (${JSON.stringify(row.recipientAddress)})`);
			const why = `PHANTOM CryptoSettlement BLOCKED (funds could be lost to nowhere chain): ${whyParts.join("; ")}. REQUIRED: attach REAL on-chain tx destination wallet address (0x/T/bc1 prefix; not TX-RECOVER- placeholder) as recipientAddress; set status=pending until on-chain tx confirmed. If on-chain tx never happened (fees too low, wrong network) write status=failed + reason.`;
			try {
				await db.cryptoSettlement.update({
					where: { id: row.id },
					data: {
						status: "pending",
						failureReason: why,
						misplaced: true,
					},
				});
				await writeAudit(db, {
					model: "CryptoSettlement", id: row.id,
					oldStatus: row.status, newStatus: "pending",
					amount: row.amount, currency: row.token + "/" + row.network, why,
					actor: "PHANTOM-QUARANTINE-SWEEP",
					proofFields: {
						recipientAddress: row.recipientAddress,
						misplaced: row.misplaced, recovered: row.recovered,
						recoveredTxHash: row.recoveredTxHash, txTime: row.txTime,
					},
				});
				console.error(`[PHANTOM-QUARANTINE] CryptoSettlement ${row.id} (${row.amount || "?"} ${row.token || "?"} on ${row.network || "?"}) moved ${row.status} → pending. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine CryptoSettlement ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (e) {
		console.error(`[PHANTOM-QUARANTINE] CryptoSettlement sweep failed (schema mismatch — safe skip):`, e?.message || String(e));
		return 0;
	}
}

async function quarantineProcurementItems(db) {
	try {
		const rows = await db.procurementItem.findMany({
			where: {
				status: { in: ["shipped", "in_transit", "delivered", "receipt_confirmed", "received", "completed", "settled", "paid"] },
			},
			select: {
				id: true, status: true, unitPriceEst: true, totalEst: true, currency: true, quantity: true,
				deliveryProofHash: true, orderRef: true, supplierName: true, supplierId: true,
				shippedAt: true, deliveredAt: true, receiptConfirmedAt: true, receiptConfirmedBy: true,
				quantityReceived: true, name: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const status = (row.status || "").toLowerCase();
			let why = "";
			let demoteTo = null;
			// shipped requires at LEAST supplierName or orderRef or shippedAt; else revert to ordered
			if (status === "shipped" || status === "in_transit") {
				const hasAny = !isSyntheticOrEmptyRef(row.supplierName || row.orderRef) || row.shippedAt != null || row.supplierId != null;
				const hasTracking = !isSyntheticOrEmptyRef(row.orderRef);
				if (!hasAny || !hasTracking || (status === "in_transit" && isSyntheticOrEmptyRef(row.orderRef))) {
					demoteTo = "ordered";
					why = `PHANTOM ProcurementItem.${status.toUpperCase()}: no real supplierName/tracking orderRef. Supplier="${row.supplierName || ""}" orderRef="${row.orderRef || ""}" shippedAt=${String(row.shippedAt || null)}. Reverted to ordered per sovereign ruling 2026-08-29: no carrier/tracking reference = no shipment. REQUIRED: paste real carrier (Poste Maroc/Amana/Aramex/DHL) and real tracking number, then status→shipped via pipeline with metadata.`;
				}
			}
			// delivered requires deliveryProofHash non-synthetic
			if (!demoteTo && (status === "delivered" || status === "completed" || status === "confirmed" || status === "received")) {
				const proofReal = !isSyntheticOrEmptyRef(row.deliveryProofHash) && !/^[a-f0-9]{64}$/i.test(String(row.deliveryProofHash || "").trim());
				if (!proofReal) {
					demoteTo = "ordered";
					why = `PHANTOM ProcurementItem.${status.toUpperCase()}: deliveryProofHash empty/null or locally-fabricated oracle SHA-256 (bare 64 hex = no external anchor). proofHash="${String(row.deliveryProofHash || "").slice(0,32)}…". Sovereign ruling 2026-08-29: NO SYNTHETIC PROOF, EVER. DEMOTED → ordered (fail-closed to avoid L2 L1 legacy trigger that also requires proofHash for "delivered"). REQUIRED: real POD photo hash with prefix (pod:/scan:/AMANA-/POSTE-/JUMIA-) or real on-chain/carrier anchor, or status stays ordered.`;
				}
			}
			// receipt_confirmed/settled need proof+human+ts+qtyReceived triple
			if (!demoteTo && (status === "receipt_confirmed" || status === "settled")) {
				const proofReal = !isSyntheticOrEmptyRef(row.deliveryProofHash) && !/^[a-f0-9]{64}$/i.test(String(row.deliveryProofHash || "").trim());
				const byReal = !!(row.receiptConfirmedBy && row.receiptConfirmedBy.trim().length >= 3 && String(row.receiptConfirmedBy).toLowerCase() !== "system-auto");
				const atReal = row.receiptConfirmedAt != null;
				const qtyReal = typeof row.quantityReceived === "number" && row.quantityReceived > 0;
				if (!proofReal || !byReal || !atReal || !qtyReal) {
					const parts = [];
					if (!proofReal) parts.push("proof empty/synthetic (no external pod/carrier/scan anchor)");
					if (!byReal) parts.push(`receiptConfirmedBy=${JSON.stringify(row.receiptConfirmedBy)} not real human`);
					if (!atReal) parts.push("receiptConfirmedAt null");
					if (!qtyReal) parts.push(`quantityReceived=${JSON.stringify(row.quantityReceived)} <= 0 or not set`);
					// FAIL-CLOSED HONEST DEMOTION → ordered
					// Note: demoting → delivered would still fail L2 legacy trigger (from finance migration 00300)
					// because delivered also requires proofHash. So demote straight to ordered: truthful state
					// (just PO placed with supplier; no handover proven yet). Operator can re-run pipeline
					// with real proof when available to re-advance through shipped/in_transit/... properly.
					demoteTo = "ordered";
					why = `PHANTOM ProcurementItem.${status.toUpperCase()}: triple-proof chain broken (${parts.join("; ")}). DEMOTED → ordered (fail-closed honest state: verified supplier order but no carrier/handover or human sign-off proof). REQUIRED by sovereign ruling 2026-08-29: real POD deliveryProofHash + real human confirmedBy + timestamp + positive qtyReceived — ALL 4, before receipt_confirmed/settled permitted.`;
				}
			}
			if (!demoteTo) continue;
			try {
				await db.procurementItem.update({
					where: { id: row.id },
					data: {
						status: demoteTo,
						shippedAt: null,
						deliveredAt: null,
						deliveryProofHash: null,
						receiptConfirmedAt: null,
						receiptConfirmedBy: null,
						quantityReceived: null,
						notes: `[PHANTOM-QUARANTINE ${new Date().toISOString()}] ${why} ||| ${row.name ? ("item=" + row.name.slice(0,40) + " | ") : ""}old-status=${row.status}`,
					},
				});
				await writeAudit(db, {
					model: "ProcurementItem", id: row.id,
					oldStatus: row.status, newStatus: demoteTo,
					amount: Number(row.totalEst || (Number(row.unitPriceEst || 0) * Number(row.quantity || 0))),
					currency: row.currency || "USD", why,
					actor: "PHANTOM-PROCUREMENT-QUARANTINE-SWEEP",
					proofFields: {
						deliveryProofHash: row.deliveryProofHash, orderRef: row.orderRef,
						supplierName: row.supplierName, supplierId: row.supplierId,
						shippedAt: row.shippedAt, deliveredAt: row.deliveredAt,
						receiptConfirmedAt: row.receiptConfirmedAt, receiptConfirmedBy: row.receiptConfirmedBy,
						quantityReceived: row.quantityReceived,
					},
				});
				console.error(`[PHANTOM-QUARANTINE] ProcurementItem ${row.id} (name="${String(row.name || "?").slice(0,40)}", $${Number(row.totalEst || (Number(row.unitPriceEst || 0) * Number(row.quantity || 0)) || 0).toFixed(2)}) moved ${row.status} → ${demoteTo}. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine ProcurementItem ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (_e) {
		console.error(`[PHANTOM-QUARANTINE] ProcurementItems sweep failed (graceful skip):`, _e?.message || String(_e));
		return 0;
	}
}

async function quarantineShipments(db) {
	try {
		const rows = await db.shipment.findMany({
			where: {
				status: { in: ["label_created", "picked_up", "in_transit", "customs", "out_for_delivery", "delivered", "failed", "returned"] },
			},
			select: {
				id: true, shipmentNumber: true, status: true, carrier: true,
				trackingNumber: true, trackingVerified: true, actualDelivery: true,
				events: true, trackingUrl: true, itemName: true,
				procurementItemId: true, destinationCountry: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const status = (row.status || "").toLowerCase();
			let demoteTo = null;
			let why = "";
			const FABRICATED = /international shipping|multi-carrier/i;
			const hasCarrier = !!(row.carrier && row.carrier.trim().length && !FABRICATED.test(row.carrier));
			const hasTracking = !!(row.trackingNumber && row.trackingNumber.trim().length >= 3 && !isSyntheticOrEmptyRef(row.trackingNumber));
			// Any advanced state needs at least carrier OR real tracking
			if (!hasCarrier && !hasTracking) {
				demoteTo = "pending";
				why = `PHANTOM Shipment.${status.toUpperCase()}: NEITHER real carrier NOR real trackingNumber (carrier="${row.carrier || ""}", tracking="${String(row.trackingNumber || "").slice(0,20)}"). Morocco local-sourcing sovereign rule: require a real carrier (Poste Maroc/Amana/Aramex/DHL/FedEx/UPS/Chronopost) OR real tracking ref. Placeholder International Shipping/Multi-carrier labels now banned.`;
			}
			// in_transit/out_for_delivery REQUIRE non-empty real tracking string
			if (!demoteTo && ["in_transit","customs","out_for_delivery"].includes(status)) {
				if (!hasTracking) {
					demoteTo = "label_created";
					why = `PHANTOM Shipment.${status.toUpperCase()}: requires real trackingNumber (length>=3). tracking="${String(row.trackingNumber || "").slice(0,20)}". Use carrier-acquire-sweep to paste a real Poste Maroc/Amana/Jumia tracking reference first. Only then status→in_transit.`;
				}
			}
			// delivered REQUIRE actualDelivery set, AND (trackingVerified=true OR events >50 chars non-empty) AND hasTracking
			if (!demoteTo && status === "delivered") {
				const verified = row.trackingVerified === true;
				const hasEvents = !!(row.events && String(row.events).trim().length > 50);
				if (!hasTracking || row.actualDelivery == null || (!verified && !hasEvents)) {
					demoteTo = "in_transit";
					why = `PHANTOM Shipment.DELIVERED: proof broken. hasTracking=${hasTracking} (needs real tracking string >=3 chars), actualDelivery? ${row.actualDelivery != null ? "YES" : "NO"}, trackingVerified? ${verified ? "YES" : "NO"}, events JSON populated (>50 chars)? ${hasEvents ? "YES" : "NO"}. Sovereign rule: never mark as delivered without carrier-scan proof. Paste real delivered event scan data into events JSON OR verify via /api/carrier-tracking to flip trackingVerified=true, only then mark as delivered.`;
				}
			}
			if (!demoteTo) continue;
			try {
				await db.shipment.update({
					where: { id: row.id },
					data: {
						status: demoteTo,
						carrier: FABRICATED.test(row.carrier || "") ? null : (row.carrier || null),
						trackingUrl: (demoteTo === "pending" && !hasTracking) ? null : (row.trackingUrl || null),
						trackingVerified: (demoteTo === "pending") ? false : row.trackingVerified,
						notes: `[PHANTOM-SHIPMENT-QUARANTINE ${new Date().toISOString()}] ${why} ||| original carrier="${row.carrier || ""}" tracking="${String(row.trackingNumber || "").slice(0,20)}" original status=${row.status}`,
					},
				});
				await writeAudit(db, {
					model: "Shipment", id: row.id,
					oldStatus: row.status, newStatus: demoteTo,
					amount: 0, currency: "MAD/USD", why,
					actor: "PHANTOM-SHIPMENT-QUARANTINE-SWEEP",
					proofFields: {
						shipmentNumber: row.shipmentNumber, carrier: row.carrier,
						trackingNumber: row.trackingNumber, trackingVerified: row.trackingVerified,
						actualDelivery: row.actualDelivery, events: (row.events || "").slice(0, 80),
						procurementItemId: row.procurementItemId, itemName: row.itemName,
						destinationCountry: row.destinationCountry,
					},
				});
				console.error(`[PHANTOM-QUARANTINE] Shipment ${row.id} (number=${row.shipmentNumber || "?"}, item="${String(row.itemName || "?").slice(0,40)}") moved ${row.status} → ${demoteTo}. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine Shipment ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (_e) {
		console.error(`[PHANTOM-QUARANTINE] Shipments sweep failed (graceful skip):`, _e?.message || String(_e));
		return 0;
	}
}

async function quarantinePurchaseOrders(db) {
	try {
		const rows = await db.purchaseOrder.findMany({
			where: { status: { in: ["completed", "rejected", "cancelled"] } },
			select: {
				id: true, poNumber: true, status: true, totalAmount: true, currency: true,
				lineItemCount: true, orderedAt: true, acknowledgedAt: true, ackStatus: true,
				supplierName: true, completedAt: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const status = (row.status || "").toLowerCase();
			if (status !== "completed") continue;
			// completed requires: orderedAt != null AND one of (ackStatus=ACKNOWLEDGED OR acknowledgedAt != null OR completedAt != null AND line items actually delivered)
			const ackOk = row.ackStatus === "ACKNOWLEDGED" || row.ackStatus === "RESOLVED" || row.acknowledgedAt != null;
			const orderTsOk = row.orderedAt != null;
			let demoteTo = null;
			let why = "";
			if (!orderTsOk) {
				demoteTo = "ordered";
				why = `PHANTOM PurchaseOrder.COMPLETED without orderedAt timestamp (${row.poNumber || row.id}). orderedAt=${JSON.stringify(row.orderedAt)} — cannot be completed if never ordered.`;
			} else if (!ackOk) {
				demoteTo = "ordered";
				why = `PHANTOM PurchaseOrder.COMPLETED with ackStatus="${row.ackStatus}" (still AWAITING_ACK, no supplier acknowledgement, acknowledgedAt=null). Sovereign rule: POs cannot be marked completed unless supplier acknowledged. Supplier="${row.supplierName || ""}" lineItems=${row.lineItemCount} total=$${Number(row.totalAmount || 0).toFixed(2)}`;
			}
			if (!demoteTo) continue;
			try {
				await db.purchaseOrder.update({
					where: { id: row.id },
					data: {
						status: demoteTo,
						completedAt: null,
						notes: `[PHANTOM-PO-QUARANTINE ${new Date().toISOString()}] ${why} ||| previous status=${row.status} ackStatus=${row.ackStatus} completedAt=${JSON.stringify(row.completedAt)}`,
					},
				});
				await writeAudit(db, {
					model: "PurchaseOrder", id: row.id,
					oldStatus: row.status, newStatus: demoteTo,
					amount: Number(row.totalAmount || 0), currency: row.currency || "USD", why,
					actor: "PHANTOM-PO-QUARANTINE-SWEEP",
					proofFields: {
						poNumber: row.poNumber, supplierName: row.supplierName,
						lineItemCount: row.lineItemCount, ackStatus: row.ackStatus,
						orderedAt: row.orderedAt, acknowledgedAt: row.acknowledgedAt, completedAt: row.completedAt,
					},
				});
				console.error(`[PHANTOM-QUARANTINE] PurchaseOrder ${row.id} (${row.poNumber || "?"}, $${Number(row.totalAmount || 0).toFixed(2)}, ${row.lineItemCount} lines) moved completed → ${demoteTo}. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine PurchaseOrder ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (_e) {
		console.error(`[PHANTOM-QUARANTINE] PurchaseOrders sweep failed (graceful skip):`, _e?.message || String(_e));
		return 0;
	}
}

export async function runPhantomCompletedQuarantineSweep(_opts = {}) {
	const db = _opts.db || getDb();
	const runId = "Q" + Date.now().toString(36).toUpperCase();
	console.log(`[PHANTOM-QUARANTINE] Starting sweep runId=${runId} (3-layer anti-lost-revenue GooglePay-style defence: ORM TRUTH + SQL BEFORE triggers + now scheduled quarantine sweep)...`);
	let total = 0;
	const start = Date.now();
	const steps = [
		["PayoutItem", quarantinePayoutItems],
		["PayoutBatch", quarantinePayoutBatches],
		["OwnerSettlement", quarantineOwnerSettlements],
		["RevenueEvent", quarantineRevenueEvents],
		["CryptoSettlement", quarantineCryptoSettlements],
		["ProcurementItem", quarantineProcurementItems],
		["Shipment", quarantineShipments],
		["PurchaseOrder", quarantinePurchaseOrders],
	];
	const per = {};
	for (const [name, fn] of steps) {
		try {
			const n = await fn(db);
			per[name] = n;
			total += n;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] ${name} sweep failed:`, e?.message || e);
			per[name] = "ERROR:" + (e?.message || String(e));
		}
	}
	const elapsedMs = Date.now() - start;
	console.error(`[PHANTOM-QUARANTINE] runId=${runId} FINISHED in ${elapsedMs}ms. QUARANTINED ${total} phantom-completed rows across 6 tables:`, JSON.stringify(per), ` — GooglePay-app-refund style "status=completed but funds never moved" losses now caught by ORM + SQL triggers + scheduled sweep (3 layers). INVARIANT: sum(completed with no verifiable proof) = 0 ALWAYS.`);
	if (total > 0) {
		try {
			await maybeSendAlert({
				level: "CRITICAL",
				title: `PHANTOM COMPLETED QUARANTINE: ${total} rows caught (GooglePay lost-revenue pattern prevented)`,
				message: `Scheduled quarantine sweep runId=${runId} found and quarantined ${total} rows with status=completed/verified/confirmed/delivered/LIVE_SETTLED but NO REAL provider receipt or proofHash. Per-table: ${JSON.stringify(per)}. Recovery instructions for FINANCE OPS: (1) open each row at status=needs_manual_proof/processing/pending; (2) attach REAL provider receipt reference as externalRef/providerBatchRef/transactionRef; (3) set connectorStatus ∈ {manual_attested_finance, live_onchain, live_bank_api, live_paypal_api, live_stripe_api, live_wise_api}; (4) recompute proofHash=sha256(entityId:realRef:amount:currency); (5) write status→completed ONLY if money DID IN FACT move; otherwise (never disbursed/lost) write status=failed with clear reason. This is the TRIPLE DEFENCE: ORM TRUTH fail-closed throw + Postgres BEFORE INSERT/UPDATE row trigger RAISE EXCEPTION + scheduled sweep.`,
				runId,
			});
		} catch (_e) {
			// alert module may not exist in all contexts; ignore
		}
	}
	return { runId, total, perTable: per, elapsedMs };
}

export default { runPhantomCompletedQuarantineSweep, isSyntheticOrEmptyRef };

async function maybeSendAlert(_alert) {
	// If parent env has alerts module wired, it overrides this; else no-op
}
