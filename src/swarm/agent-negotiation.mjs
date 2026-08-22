import { createExperienceEnvelope } from "./axp-schema.mjs";
import { lookupIntent, recordResolution } from "./semantic-cache.mjs";

/**
 * Agent Communication Protocol (ACP) - Basic Negotiation Module
 * Enables autonomous negotiation between a Buyer Agent and a Seller Agent.
 */

export const NEGOTIATION_STATUS = {
	OPEN: "OPEN",
	PROPOSAL: "PROPOSAL",
	COUNTER_PROPOSAL: "COUNTER_PROPOSAL",
	AGREED: "AGREED",
	REJECTED: "REJECTED",
	TIMEOUT: "TIMEOUT",
};

export class AgentNegotiator {
	constructor(config = {}) {
		this.maxRounds = config.maxRounds || 3;
		this.timeoutMs = config.timeoutMs || 5000; // 5 seconds per turn
		this.minMargin = config.minMargin || 0.15; // 15% margin guardrail
	}

	/**
	 * Conducts a negotiation session between buyer and seller.
	 * @param {Object} buyerIntent - The buyer's goal/intent and constraints.
	 * @param {Object} sellerOffering - The seller's product/service envelope.
	 * @param {Object} context - { buyerResources, sellerResources } (Leverage/Assets)
	 */
	async negotiate(buyerIntent, sellerOffering, context = {}) {
		const buyerResources = context.buyerResources || {
			budget: Infinity,
			reputation: 50,
		};
		const sellerResources = context.sellerResources || {
			inventory: Infinity,
			brand: 50,
		};

		const session = {
			id: crypto.randomUUID(),
			status: NEGOTIATION_STATUS.OPEN,
			rounds: [],
			startedAt: new Date().toISOString(),
			buyer: { intent: buyerIntent, resources: buyerResources },
			seller: {
				offering: createExperienceEnvelope(sellerOffering),
				resources: sellerResources,
			},
		};

		// 1. Initial Proposal from Seller (List Price)
		// Adjust initial offer based on Seller Leverage (e.g., high brand = strict price)
		const basePrice = session.seller.offering.economics.price;
		let initialAsk = basePrice;

		if (sellerResources.brand > 80 || sellerResources.inventory < 5) {
			// High leverage: Start firm or even slightly higher (premium)
			initialAsk = basePrice;
		} else if (sellerResources.inventory > 100) {
			// Low leverage: Start with a slight discount to move volume? Or standard.
			initialAsk = basePrice;
		}

		let currentProposal = {
			price: initialAsk,
			currency: session.seller.offering.economics.currency,
			terms: "standard",
			source: "seller",
		};
		session.rounds.push(currentProposal);
		session.status = NEGOTIATION_STATUS.PROPOSAL;

		// 2. Negotiation Loop
		for (let i = 0; i < this.maxRounds; i++) {
			// Buyer Turn
			const buyerResponse = this.decideBuyer(
				buyerIntent,
				buyerResources,
				currentProposal,
				session.seller.offering,
			);

			if (buyerResponse.action === "ACCEPT") {
				session.status = NEGOTIATION_STATUS.AGREED;
				session.finalAgreement = currentProposal;
				break;
			} else if (buyerResponse.action === "REJECT") {
				session.status = NEGOTIATION_STATUS.REJECTED;
				break;
			} else if (buyerResponse.action === "COUNTER") {
				currentProposal = buyerResponse.proposal;
				currentProposal.source = "buyer";
				session.rounds.push(currentProposal);
				session.status = NEGOTIATION_STATUS.COUNTER_PROPOSAL;
			}

			// Seller Turn (Evaluate Counter)
			const sellerResponse = this.decideSeller(
				session.seller.offering,
				sellerResources,
				currentProposal,
			);

			if (sellerResponse.action === "ACCEPT") {
				session.status = NEGOTIATION_STATUS.AGREED;
				session.finalAgreement = currentProposal;
				break;
			} else if (sellerResponse.action === "REJECT") {
				session.status = NEGOTIATION_STATUS.REJECTED;
				break;
			} else if (sellerResponse.action === "COUNTER") {
				currentProposal = sellerResponse.proposal;
				currentProposal.source = "seller";
				session.rounds.push(currentProposal);
				session.status = NEGOTIATION_STATUS.PROPOSAL; // Back to proposal
			}
		}

		// 3. Close Session
		if (
			session.status !== NEGOTIATION_STATUS.AGREED &&
			session.status !== NEGOTIATION_STATUS.REJECTED
		) {
			session.status = NEGOTIATION_STATUS.TIMEOUT;
		}

		session.endedAt = new Date().toISOString();

		// Record successful negotiations in semantic cache for future optimization
		if (session.status === NEGOTIATION_STATUS.AGREED) {
			recordResolution(
				`negotiation:${buyerIntent.intent || "general"}`,
				session.finalAgreement,
			);
		}

		return session;
	}

	decideBuyer(intent, resources, proposal, product) {
		const maxPrice = intent.maxPrice || Infinity;
		let targetPrice = intent.targetPrice || maxPrice * 0.9;

		// Leverage: If buyer has high reputation or bulk commitment, target lower
		if (resources.reputation > 80) targetPrice *= 0.95;
		if (resources.volumeCommitment > 10) targetPrice *= 0.9;

		if (proposal.price <= targetPrice) {
			return { action: "ACCEPT" };
		} else if (proposal.price > maxPrice) {
			return { action: "REJECT", reason: "price_too_high" };
		} else {
			// Counter offer
			return {
				action: "COUNTER",
				proposal: {
					...proposal,
					price: targetPrice,
					terms: "negotiated",
				},
			};
		}
	}

	decideSeller(product, resources, proposal) {
		// Strict Unit Economics Guardrail
		const cost = product.economics.unitCost || 0;
		const minPrice = cost * (1 + this.minMargin);

		// Leverage: If seller is "starving" (low inventory turnover, low cash), accept lower offers
		let acceptanceThreshold = product.economics.price;
		if (resources.cashCrunch) acceptanceThreshold *= 0.8;
		else if (resources.inventory > 1000) acceptanceThreshold *= 0.9;

		if (proposal.price >= acceptanceThreshold) {
			return { action: "ACCEPT" };
		} else if (proposal.price >= minPrice) {
			// Accept if it still meets min margin, maybe adding a counter to nudge up?
			const acceptable = Math.max(minPrice * 1.05, acceptanceThreshold * 0.9);
			if (proposal.price >= acceptable) {
				return { action: "ACCEPT" };
			} else {
				// Counter halfway
				return {
					action: "COUNTER",
					proposal: {
						...proposal,
						price: Math.floor((acceptanceThreshold + proposal.price) / 2),
					},
				};
			}
		} else {
			return { action: "REJECT", reason: "unit_economics_violation" };
		}
	}
}
