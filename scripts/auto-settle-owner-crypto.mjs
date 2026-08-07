import "dotenv/config";
import SWARML2PaymentProcessor from "../src/revenue/swarm-l2-payment-processor.js";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv);
	const processor = new SWARML2PaymentProcessor();
	const providerPriority = args.providers
		? String(args.providers)
				.split(",")
				.map((s) => String(s).trim().toLowerCase())
				.filter(Boolean)
		: undefined;
	const result = await processor.sweepConfirmedRevenueToOwner({
		providerPriority,
		minAmount: args["min-amount"] != null ? Number(args["min-amount"]) : null,
		maxAmount: args["max-amount"] != null ? Number(args["max-amount"]) : null,
	});
	process.stdout.write(
		JSON.stringify(
			{
				ok: result.ok === true,
				scanned: result.scanned,
				sent: result.sent,
				queued: result.queued,
				failed: result.failed,
				attempts: result.attempts,
				checkedAt: result.checkedAt,
			},
			null,
			2,
		) + "\n",
	);
}

main().catch((e) => {
	process.stdout.write(
		JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2) +
			"\n",
	);
	process.exit(1);
});
