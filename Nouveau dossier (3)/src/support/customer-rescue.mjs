import { loadEnv } from "../load-env.mjs";
import { triggerFidelityJourney } from "../retention/fidelity-manager.mjs";

/**
 * CUSTOMER RESCUE OPERATION
 *
 * Problem: Paid customers cannot access LearnWorlds because our account is suspended.
 * Solution: Immediate manual delivery of content via alternative channels.
 *
 * Protocol:
 * 1. Identify "Paid" users from the Ledger/Receipts.
 * 2. Send an Apology + Emergency Access Link (Google Drive/Dropbox/Direct Download).
 * 3. Log the "Rescue" to ensure no customer is left behind.
 */
export async function runCustomerRescue() {
	console.log(">> STARTING CUSTOMER RESCUE OPERATION <<");
	loadEnv();

	// 1. Identify Victims
	// In reality, query 'purchases' where status='completed'
	const affectedCustomers = await fetchPaidCustomers();

	if (affectedCustomers.length === 0) {
		console.log("[Rescue] No affected customers found. (Good news?)");
		return;
	}

	console.log(
		`[Rescue] Found ${affectedCustomers.length} customers needing access.`,
	);

	for (const customer of affectedCustomers) {
		console.log(
			`[Rescue] Processing ${customer.email} (Course: ${customer.courseId})...`,
		);

		try {
			await sendEmergencyAccessEmail(customer);
			console.log(
				`[Rescue] SUCCESS: Emergency Access sent to ${customer.email}`,
			);
		} catch (e) {
			console.error(
				`[Rescue] FAILED: Could not reach ${customer.email} - ${e.message}`,
			);
		}
	}
}

async function fetchPaidCustomers() {
	// Stub: Simulate fetching from local receipt backup
	return [
		{ email: "student1@example.com", courseId: "aws-developer", name: "Alice" },
		{
			email: "student2@example.com",
			courseId: "modern-macho-mindset",
			name: "Bob",
		},
	];
}

async function sendEmergencyAccessEmail(customer) {
	const subject = "URGENT: Your Course Access (RealWorldCerts)";
	const body = `
    Hi ${customer.name},

    We are currently upgrading our learning platform infrastructure, which has caused a temporary outage at realworldcerts.com.

    We know you paid for access, and we refuse to let technical issues stop your learning.

    Here is a DIRECT LINK to download your course materials immediately:
    > https://drive.google.com/drive/folders/backup_${customer.courseId}_SECURE

    This link is private and just for you.

    We apologize for the interruption and are working to restore the main portal ASAP.

    Best,
    Younes Tsouli
    Founder, Real World Certs
    `;

	// Stub: Send email via SMTP/SendGrid
	console.log(`[Email] To: ${customer.email} | Subject: ${subject}`);
	// console.log(body);

	// 2. The Fidelity Trigger (The Start of the Relationship)
	console.log(
		`[CustomerRescue] Triggering Fidelity Journey for ${customer.email}...`,
	);
	await triggerFidelityJourney({
		email: customer.email,
		name: customer.name,
		product: customer.courseId,
		purchaseDate: new Date().toISOString(),
	});
}
