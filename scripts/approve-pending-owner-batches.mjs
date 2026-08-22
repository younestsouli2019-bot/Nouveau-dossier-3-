import "dotenv/config";
import { buildBase44ServiceClient } from "../src/base44-client.mjs";
import { OwnerSettlementEnforcer } from "../src/policy/owner-settlement.mjs";
import {
	getPayoutBatchConfigFromEnv,
	resolveRecipientAddress,
	normalizeRecipientType,
} from "../src/emit-revenue-events.mjs";
import { getEarningConfigFromEnv } from "../src/base44-earning.mjs";

async function main() {
	const client = buildBase44ServiceClient({ mode: "online" });
	if (!client) {
		console.error("Failed to build Base44 client");
		process.exit(1);
	}

	const payoutBatchCfg = getPayoutBatchConfigFromEnv();
	const earningCfg = getEarningConfigFromEnv();
	const batchEntity = client.asServiceRole.entities[payoutBatchCfg.entityName];
	const earningEntity = client.asServiceRole.entities[earningCfg.entityName];

	console.log("Scanning for pending batches...");

	// List pending batches
	const batches = await batchEntity.filter(
		{ [payoutBatchCfg.fieldMap.status]: "pending_approval" },
		"-created_date",
		100,
		0,
	);

	if (!Array.isArray(batches) || batches.length === 0) {
		console.log("No pending batches found.");
		return;
	}

	console.log(`Found ${batches.length} pending batches.`);

	for (const batch of batches) {
		const batchId = batch[payoutBatchCfg.fieldMap.batchId];
		const notes = batch[payoutBatchCfg.fieldMap.notes];
		const recipientType = notes?.recipient_type ?? notes?.recipientType;
		const beneficiary = notes?.beneficiary;

		console.log(
			`Checking batch ${batchId} (Type: ${recipientType}, Beneficiary: ${beneficiary})`,
		);

		// Determine owner account for this type
		const ownerAccount =
			OwnerSettlementEnforcer.getOwnerAccountForType(recipientType);

		// We need to verify if the recipient matches the owner account
		// Since we don't have the items/earnings easily joined here without more calls,
		// we rely on the batch notes if available, or fetch earnings.

		let isOwner = false;

		// Strategy 1: Check notes if they contain recipient email/account
		const noteRecipient = notes?.recipient_email ?? notes?.recipient;
		if (noteRecipient && ownerAccount) {
			if (
				String(noteRecipient).toLowerCase() ===
				String(ownerAccount).toLowerCase()
			) {
				isOwner = true;
			}
		}

		// Strategy 2: If notes ambiguous, fetch earnings linked to batch (if possible) or just rely on 'beneficiary' name if it matches Owner
		if (!isOwner && beneficiary) {
			// Rough check: if beneficiary name contains "Owner" or matches env var
			const ownerName = process.env.OWNER_BENEFICIARY_NAME;
			if (
				ownerName &&
				String(beneficiary)
					.toLowerCase()
					.includes(String(ownerName).toLowerCase())
			) {
				isOwner = true;
			}
			if (String(beneficiary).toLowerCase() === "owner") {
				isOwner = true;
			}
		}

		if (isOwner) {
			console.log(`  -> IDENTIFIED AS OWNER BATCH. Approving...`);
			const now = new Date().toISOString();
			await batchEntity.update(batch.id, {
				[payoutBatchCfg.fieldMap.status]: "approved",
				[payoutBatchCfg.fieldMap.approvedAt]: now,
				approved_by: "script:approve-pending-owner-batches",
			});
			console.log(`  -> APPROVED.`);
		} else {
			console.log(
				`  -> Not identified as owner (Owner Account: ${ownerAccount}, Batch Recipient: ${noteRecipient}). Skipping.`,
			);
		}
	}
}

main().catch(console.error);
