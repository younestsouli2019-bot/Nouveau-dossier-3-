import { ExternalPaymentAPI } from "../src/api/external-payment-api.mjs";

async function releaseBatchFromSource() {
	console.log(
		"🚀 RELEASING BATCH_LIVE_1767528254631 FROM SOURCE TO OWNER CRYPTO WALLET...",
	);

	const api = new ExternalPaymentAPI();
	await api.initialize();

	const items = [
		{
			amount: 850.0,
			currency: "USDT",
			recipient_address: "0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7",
			network: "BEP20",
			coin: "USDT",
			note: "BATCH_LIVE_1767528254631 - Direct Crypto Release to Owner Trust Wallet",
			method: "crypto_direct",
		},
	];

	console.log("📤 Requesting direct crypto settlement from source...");
	console.log("💰 Amount:", items[0].amount, items[0].currency);
	console.log("📍 Destination:", items[0].recipient_address);
	console.log("🔗 Network:", items[0].network);

	try {
		const res = await api.requestCryptoTransfer({
			payoutBatchId: "BATCH_LIVE_1767528254631_CRYPTO",
			items,
			actor: "OwnerDirectCryptoRelease",
		});

		console.log("✅ RELEASE REQUEST SENT!");
		console.log("Response:", JSON.stringify(res, null, 2));

		if (res.success) {
			console.log("🎉 SUCCESS: Funds released from source to owner wallet!");
			console.log("📍 Transaction ID:", res.transactionId);
			console.log("💰 Amount:", res.amount, res.currency);
			console.log("📬 Destination:", res.destination);

			if (res.txHash) {
				console.log(
					"🔍 View on blockchain: https://bscscan.com/tx/" + res.txHash,
				);
			}
		} else {
			console.log("⚠️  Release status:", res.status);
			if (res.message) console.log("Message:", res.message);
		}
	} catch (error) {
		console.error("❌ Release failed:", error.message);
		throw error;
	}
}

releaseBatchFromSource().catch((e) => {
	console.error("❌ Final release failed:", e.message);
	process.exit(1);
});
