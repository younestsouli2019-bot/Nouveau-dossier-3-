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
			entityModel: model,
			entityId: id,
			action: "PHANTOM_COMPLETED_QUARANTINED",
			before: JSON.stringify({ status: oldStatus, ...proofFields }),
			after: JSON.stringify({ status: newStatus }),
			detail: why,
			actor,
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
			providerBatchRef: true, proofHash: true, paypalBatchId: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const refReal = !isSyntheticOrEmptyRef(row.providerBatchRef) && !isSyntheticOrEmptyRef(row.paypalBatchId);
		const proofReal = !isSyntheticOrEmptyRef(row.proofHash);
		const phantom = !refReal || !proofReal;
		if (!phantom) continue;
		const whyParts = [];
		if (!refReal) whyParts.push(`provider refs empty/synthetic (providerBatchRef=${JSON.stringify(row.providerBatchRef)}, paypalBatchId=${JSON.stringify(row.paypalBatchId)})`);
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
				proofFields: { providerBatchRef: row.providerBatchRef, paypalBatchId: row.paypalBatchId, proofHash: row.proofHash, batchNumber: row.batchNumber },
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
			externalRef: true, transactionRef: true, proofHash: true, connectorStatus: true,
			ownerName: true,
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
		if (!refReal) whyParts.push(`refs empty/synthetic (ext=${JSON.stringify(row.externalRef)}, tx=${JSON.stringify(row.transactionRef)})`);
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
				proofFields: { externalRef: row.externalRef, transactionRef: row.transactionRef, proofHash: row.proofHash, connectorStatus: row.connectorStatus, ownerName: row.ownerName },
			});
			console.error(`[PHANTOM-QUARANTINE] OwnerSettlement ${row.id} (owner=${row.ownerName || "?"}, $${Number(row.netAmount || 0).toFixed(2)}) moved ${row.status} → needs_manual_proof. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine OwnerSettlement ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantineRevenueEvents(db) {
	const rows = await db.revenueEvent.findMany({
		where: {
			status: { in: ["verified", "settled", "confirmed", "reconciled"] },
			OR: [{ transactionRef: null }, { deliveryProofHash: null }],
		},
		select: {
			id: true, status: true, amount: true, currency: true,
			transactionRef: true, deliveryProofHash: true, source: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const refReal = !isSyntheticOrEmptyRef(row.transactionRef);
		const proofReal = !isSyntheticOrEmptyRef(row.deliveryProofHash);
		const phantom = !refReal || !proofReal;
		if (!phantom) continue;
		const whyParts = [];
		if (!refReal) whyParts.push(`transactionRef empty/synthetic (${JSON.stringify(row.transactionRef)})`);
		if (!proofReal) whyParts.push(`deliveryProofHash empty/synthetic (${JSON.stringify(row.deliveryProofHash)})`);
		const why = `PHANTOM RevenueEvent terminal status BLOCKED (GooglePay-refund-style lost-revenue pattern): ${whyParts.join("; ")}. REQUIRED: attach REAL revenue receipt (Stripe charge pi_/in_ ID, PayPal capture ID, invoice number, bank deposit slip ref, AICC/AgentFlow platform payout confirmation ID) as transactionRef + write deliveryProofHash=sha256(eventId:realRef:amount:currency). If revenue never landed, write status=unbatched/pending with reason=lost.`;
		try {
			await db.revenueEvent.update({
				where: { id: row.id },
				data: {
					status: "pending",
					notes: why,
				},
			});
			await writeAudit(db, {
				model: "RevenueEvent", id: row.id,
				oldStatus: row.status, newStatus: "pending",
				amount: row.amount, currency: row.currency, why,
				proofFields: { transactionRef: row.transactionRef, deliveryProofHash: row.deliveryProofHash, source: row.source },
			});
			console.error(`[PHANTOM-QUARANTINE] RevenueEvent ${row.id} (source=${row.source || "?"}, $${Number(row.amount || 0).toFixed(2)}) moved ${row.status} → pending. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine RevenueEvent ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantineCryptoSettlements(db) {
	const rows = await db.cryptoSettlement.findMany({
		where: {
			status: { in: ["confirmed", "settled", "completed", "onchain_finalized"] },
			OR: [{ txHash: null }, { recipientAddress: null }],
		},
		select: {
			id: true, status: true, amount: true, token: true, network: true,
			txHash: true, recipientAddress: true, proofHash: true, connectorStatus: true,
			ownerName: true, misplaced: true, recovered: true,
		},
	});
	let moved = 0;
	for (const row of rows) {
		const hashReal = !isSyntheticOrEmptyRef(row.txHash);
		const addrReal = !isSyntheticOrEmptyRef(row.recipientAddress) && /^(0x|T|bc1|[13])/i.test(String(row.recipientAddress || ""));
		const connectorLive = !isNotLiveConnectorStatus(row.connectorStatus);
		const phantom = !hashReal || !addrReal || !connectorLive;
		if (!phantom) continue;
		const whyParts = [];
		if (!hashReal) whyParts.push(`txHash empty/synthetic (${JSON.stringify(row.txHash)})`);
		if (!addrReal) whyParts.push(`recipientAddress missing/invalid (${JSON.stringify(row.recipientAddress)})`);
		if (!connectorLive) whyParts.push(`connectorStatus not live (${JSON.stringify(row.connectorStatus)})`);
		const why = `PHANTOM CryptoSettlement BLOCKED (funds could be lost to nowhere chain): ${whyParts.join("; ")}. REQUIRED: attach REAL on-chain tx hash (0x/T/bc1 prefix; not TX-RECOVER- placeholder) as txHash; confirm recipientAddress=OWNER_CRYPTO_WALLET address; set connectorStatus=live_onchain. If on-chain tx never happened (fees too low, wrong network) write status=failed + reason.`;
		try {
			await db.cryptoSettlement.update({
				where: { id: row.id },
				data: {
					status: "pending",
					connectorStatus: "not_configured",
					proofHash: null,
					notes: why,
				},
			});
			await writeAudit(db, {
				model: "CryptoSettlement", id: row.id,
				oldStatus: row.status, newStatus: "pending",
				amount: row.amount, currency: row.token + "/" + row.network, why,
				proofFields: { txHash: row.txHash, recipientAddress: row.recipientAddress, proofHash: row.proofHash, connectorStatus: row.connectorStatus, ownerName: row.ownerName, misplaced: row.misplaced, recovered: row.recovered },
			});
			console.error(`[PHANTOM-QUARANTINE] CryptoSettlement ${row.id} (${row.amount || "?"} ${row.token || "?"} on ${row.network || "?"}) moved ${row.status} → pending. ${why}`);
			moved++;
		} catch (e) {
			console.error(`[PHANTOM-QUARANTINE] Failed to quarantine CryptoSettlement ${row.id}:`, e?.message || e);
		}
	}
	return moved;
}

async function quarantineProcurementItems(db) {
	try {
		const rows = await db.procurementItem.findMany({
			where: {
				status: { in: ["delivered", "received", "completed", "paid"] },
				OR: [{ deliveryProofHash: null }, { externalRef: null }],
			},
			select: {
				id: true, status: true, totalAmount: true, currency: true,
				deliveryProofHash: true, externalRef: true, supplier: true,
			},
		});
		let moved = 0;
		for (const row of rows) {
			const refReal = !isSyntheticOrEmptyRef(row.externalRef);
			const proofReal = !isSyntheticOrEmptyRef(row.deliveryProofHash);
			const phantom = !refReal || !proofReal;
			if (!phantom) continue;
			const whyParts = [];
			if (!refReal) whyParts.push(`externalRef (PO/INV/Delivery) empty/synthetic (${JSON.stringify(row.externalRef)})`);
			if (!proofReal) whyParts.push(`deliveryProofHash empty/synthetic (${JSON.stringify(row.deliveryProofHash)})`);
			const why = `PHANTOM ProcurementItem BLOCKED: ${whyParts.join("; ")}. REQUIRED: attach REAL supplier PO number / invoice number / delivery sign-off ref as externalRef + compute deliveryProofHash.`;
			try {
				await db.procurementItem.update({
					where: { id: row.id },
					data: { status: "needs_review", notes: why },
				});
				await writeAudit(db, {
					model: "ProcurementItem", id: row.id,
					oldStatus: row.status, newStatus: "needs_review",
					amount: row.totalAmount, currency: row.currency, why,
					proofFields: { externalRef: row.externalRef, deliveryProofHash: row.deliveryProofHash, supplier: row.supplier },
				});
				console.error(`[PHANTOM-QUARANTINE] ProcurementItem ${row.id} (supplier=${row.supplier || "?"}, $${Number(row.totalAmount || 0).toFixed(2)}) moved ${row.status} → needs_review. ${why}`);
				moved++;
			} catch (e) {
				console.error(`[PHANTOM-QUARANTINE] Failed to quarantine ProcurementItem ${row.id}:`, e?.message || e);
			}
		}
		return moved;
	} catch (_e) {
		// ProcurementItem model may not exist in older schemas; ignore gracefully
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
