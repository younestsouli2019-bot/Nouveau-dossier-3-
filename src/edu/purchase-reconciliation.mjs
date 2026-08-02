import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getEnvBool, getEnvNumber } from "./base-client.mjs";
import { TeachableClient } from "./teachable-client.mjs";
import { LearnWorldsClient } from "./learnworlds-client.mjs";
import { MainSiteClient } from "./main-site-client.mjs";

const STATE_PATH = path.join(process.cwd(), "data", "edu", "purchase-ledger.json");

function loadLedger() {
	try {
		return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
	} catch {
		return { purchases: [] };
	}
}

function persistLedger(ledger) {
	fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
	const tmp = `${STATE_PATH}.tmp.${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), "utf-8");
	fs.renameSync(tmp, STATE_PATH);
}

export function verifyWebhookSignature({ secret, rawBody, signatureHeader }) {
	if (!secret) return true;
	if (!signatureHeader) return false;
	const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
	const provided = String(signatureHeader).replace(/^sha256=/, "").toLowerCase();
	if (expected.length !== provided.length) return false;
	return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function normalizeTeachableSale(event) {
	const data = event?.data ?? event ?? {};
	const amountRaw = data.price ?? data.amount ?? event?.sale?.price ?? 0;
	const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw || 0);
	const currency = (data.currency ?? event?.sale?.currency ?? "USD").toUpperCase();
	return {
		platform: "teachable",
		externalId: String(data.sale_id ?? data.id ?? event?.id ?? ""),
		amount,
		currency,
		occurredAt: data.created_at ?? event?.created_at ?? new Date().toISOString(),
		customerEmail: data.email ?? data.user_email ?? "",
		courseId: data.course_id ?? data.product_id ?? null,
		productName: data.product_name ?? data.course_name ?? "",
		raw: event,
	};
}

export function normalizeLearnWorldsSale(event) {
	const data = event?.data ?? event ?? {};
	const amountRaw = data.amount ?? data.total ?? data.price ?? event?.order?.total ?? 0;
	const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw || 0);
	const currency = (data.currency ?? event?.order?.currency ?? "USD").toUpperCase();
	return {
		platform: "learnworlds",
		externalId: String(data.id ?? data.order_id ?? event?.order?.id ?? ""),
		amount,
		currency,
		occurredAt: data.created_at ?? event?.order?.created_at ?? new Date().toISOString(),
		customerEmail: data.email ?? data.user_email ?? "",
		courseId: data.course_id ?? null,
		productName: data.product_title ?? data.course_title ?? "",
		raw: event,
	};
}

export function normalizeMainSiteSale(event) {
	const data = event?.data ?? event ?? {};
	const amountRaw = data.amount_cents ?? data.amount ?? data.total ?? 0;
	const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw || 0);
	const currency = (data.currency ?? "USD").toUpperCase();
	return {
		platform: "realworldcerts",
		externalId: String(data.id ?? data.order_id ?? event?.id ?? ""),
		amount,
		currency,
		occurredAt: data.created_at ?? new Date().toISOString(),
		customerEmail: data.customer_email ?? data.email ?? "",
		courseId: data.product_id ?? null,
		productName: data.product_name ?? data.title ?? "",
		affiliateCode: data.referral_code ?? data.affiliate_code ?? null,
		raw: event,
	};
}

export class PurchaseReconciler {
	constructor({ platforms = {}, ledgerPath = STATE_PATH, emitEarning, affiliateProgram } = {}) {
		this.platforms = platforms;
		this.ledgerPath = ledgerPath;
		this.emitEarning = emitEarning;
		this.affiliateProgram = affiliateProgram;
	}

	_loadLedger() {
		try {
			return JSON.parse(fs.readFileSync(this.ledgerPath, "utf-8"));
		} catch {
			return { purchases: [] };
		}
	}

	_persist(ledger) {
		fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
		const tmp = `${this.ledgerPath}.tmp.${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), "utf-8");
		fs.renameSync(tmp, this.ledgerPath);
	}

	async _verifyWithPlatform(sale) {
		if (sale.platform === "teachable") {
			if (!this.platforms.teachable) return { verified: true, note: "no client configured" };
			try {
				const saleRecord = await this.platforms.teachable.getSale(sale.externalId);
				return {
					verified: true,
					note: "matched via Teachable sales API",
					platformAmount: saleRecord?.price ?? sale.amount,
					platformCurrency: (saleRecord?.currency ?? sale.currency).toUpperCase(),
				};
			} catch (e) {
				return { verified: false, note: `Teachable verify failed: ${e.message}` };
			}
		}
		if (sale.platform === "learnworlds") {
			if (!this.platforms.learnworlds) return { verified: true, note: "no client configured" };
			try {
				const order = await this.platforms.learnworlds.getOrder(sale.externalId);
				return {
					verified: true,
					note: "matched via LearnWorlds orders API",
					platformAmount: order?.total ?? sale.amount,
					platformCurrency: (order?.currency ?? sale.currency).toUpperCase(),
				};
			} catch (e) {
				return { verified: false, note: `LearnWorlds verify failed: ${e.message}` };
			}
		}
		if (sale.platform === "realworldcerts") {
			if (!this.platforms.realworldcerts) return { verified: true, note: "no client configured" };
			try {
				const saleRecord = await this.platforms.realworldcerts.getSale(sale.externalId);
				return {
					verified: true,
					note: "matched via RealWorldCerts sales API",
					platformAmount: saleRecord?.amount_cents ?? sale.amount,
					platformCurrency: (saleRecord?.currency ?? sale.currency).toUpperCase(),
				};
			} catch (e) {
				return { verified: false, note: `RealWorldCerts verify failed: ${e.message}` };
			}
		}
		return { verified: true, note: "unknown platform" };
	}

	async reconcile({ platform, event, rawBody, signatureHeader, secret }) {
		if (!verifyWebhookSignature({ secret, rawBody, signatureHeader })) {
			return { status: "REJECTED", reason: "invalid signature" };
		}

		const sale =
			platform === "learnworlds"
				? normalizeLearnWorldsSale(event)
				: platform === "realworldcerts"
					? normalizeMainSiteSale(event)
					: normalizeTeachableSale(event);

		if (!sale.externalId || !(sale.amount > 0)) {
			return { status: "REJECTED", reason: "missing externalId or non-positive amount" };
		}

		const ledger = this._loadLedger();
		const existing = ledger.purchases.find((p) => p.externalId === sale.externalId && p.platform === sale.platform);
		if (existing) {
			return { status: "DUPLICATE", externalId: sale.externalId, platform: sale.platform };
		}

		const verification = await this._verifyWithPlatform(sale);

		const record = {
			externalId: sale.externalId,
			platform: sale.platform,
			amount: sale.amount,
			currency: sale.currency,
			occurredAt: sale.occurredAt,
			customerEmail: sale.customerEmail,
			courseId: sale.courseId,
			productName: sale.productName,
			affiliateCode: sale.affiliateCode ?? null,
			verification,
			status: verification.verified ? "VERIFIED" : "QUARANTINED",
			receivedAt: new Date().toISOString(),
		};

		if (verification.verified && sale.affiliateCode && this.affiliateProgram) {
			try {
				record.affiliate = this.affiliateProgram.recordConversion({
					externalId: sale.externalId,
					platform: sale.platform,
					affiliateCode: sale.affiliateCode,
					customerEmail: sale.customerEmail,
					amountCents: sale.amount,
				});
			} catch (e) {
				record.affiliateError = e.message;
			}
		}

		if (verification.verified && this.emitEarning) {
			try {
				record.earning = await this.emitEarning({
					amount: sale.amount,
					currency: sale.currency,
					source: `course_${sale.platform}`,
					externalId: sale.externalId,
					occurredAt: sale.occurredAt,
					metadata: {
						platform: sale.platform,
						courseId: sale.courseId,
						productName: sale.productName,
						customerEmail: sale.customerEmail,
					},
				});
			} catch (e) {
				record.earningError = e.message;
				record.status = "EARNING_FAILED";
			}
		}

		ledger.purchases.push(record);
		this._persist(ledger);
		return { status: record.status, externalId: sale.externalId, platform: sale.platform };
	}

	status() {
		const ledger = this._loadLedger();
		return {
			total: ledger.purchases.length,
			verified: ledger.purchases.filter((p) => p.status === "VERIFIED").length,
			quarantined: ledger.purchases.filter((p) => p.status === "QUARANTINED").length,
			last: ledger.purchases[ledger.purchases.length - 1] ?? null,
		};
	}
}

export default PurchaseReconciler;
