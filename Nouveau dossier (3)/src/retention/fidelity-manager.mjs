import { loadEnv } from "../load-env.mjs";

/**
 * FIDELITY MANAGER (Customer Retention Engine)
 *
 * Philosophy: "The Sale is the Wedding. The Marriage is Forever."
 * Goal: Transform "Buyers" into "Disciples".
 *
 * Journey:
 * Day 0: "The Welcome" (Immediate Access + Personal Video)
 * Day 3: "The Check-In" (Did you start? Do you need help?)
 * Day 7: "The Value Add" (Free Bonus Guide - No upsell)
 * Day 14: "The Community" (Join the inner circle)
 * Day 30: "The Ascension" (Upsell to Mentorship/Enterprise)
 */
export async function runFidelityManager() {
	return runFidelityLoop();
}

export async function triggerFidelityJourney(customer) {
	console.log(
		`[Fidelity] MANUAL TRIGGER: Starting Journey for ${customer.email}`,
	);
	await sendWelcome(customer);
}

export async function runFidelityLoop() {
	console.log(">> RUNNING FIDELITY LOOP <<");
	loadEnv();

	// 1. Fetch Active Customers
	const customers = await fetchCustomers(); // Stubbed

	for (const customer of customers) {
		const ageDays = calculateCustomerAge(customer.purchaseDate);

		try {
			if (ageDays === 0) await sendWelcome(customer);
			else if (ageDays === 3) await sendCheckIn(customer);
			else if (ageDays === 7) await sendValueAdd(customer);
			else if (ageDays === 14) await inviteToCommunity(customer);
			else if (ageDays === 30) await proposeAscension(customer);
		} catch (e) {
			console.error(
				`[Fidelity] Failed to nurture ${customer.email}: ${e.message}`,
			);
		}
	}
}

async function sendWelcome(c) {
	console.log(
		`[Fidelity] Day 0: Sending VIP Welcome to ${c.name}. "You made the right choice."`,
	);
	// Logic: Send email with direct login + unadvertised bonus
}

async function sendCheckIn(c) {
	console.log(
		`[Fidelity] Day 3: Checking in on ${c.name}. "Stuck? Let me help."`,
	);
	// Logic: Trigger "CustomerRescue" if they haven't logged in
}

async function sendValueAdd(c) {
	console.log(
		`[Fidelity] Day 7: Sending Free Gift to ${c.name}. "Thinking of you."`,
	);
	// Logic: Send PDF cheat sheet related to their course
}

async function inviteToCommunity(c) {
	console.log(`[Fidelity] Day 14: Inviting ${c.name} to WhatsApp/Discord.`);
}

async function proposeAscension(c) {
	console.log(
		`[Fidelity] Day 30: Offering Mentorship to ${c.name}. "Ready for the next level?"`,
	);
}

function calculateCustomerAge(dateStr) {
	const start = new Date(dateStr).getTime();
	const now = Date.now();
	return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

async function fetchCustomers() {
	// Stub: Returns a mix of customers at different stages
	return [
		{
			name: "New Guy",
			email: "new@test.com",
			purchaseDate: new Date().toISOString(),
		},
		{
			name: "Week Old",
			email: "week@test.com",
			purchaseDate: new Date(Date.now() - 7 * 86400000).toISOString(),
		},
	];
}
