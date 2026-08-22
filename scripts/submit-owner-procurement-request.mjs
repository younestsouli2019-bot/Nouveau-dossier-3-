import fs from "node:fs";
import path from "node:path";

function ensureDir(dir) {
	const abs = path.resolve(process.cwd(), dir);
	if (!fs.existsSync(abs)) {
		fs.mkdirSync(abs, { recursive: true });
	}
	return abs;
}

function buildRequest() {
	const now = new Date().toISOString();
	return {
		type: "owner_procurement_request",
		version: 1,
		requestedAt: now,
		status: "requested",
		owner: {
			name: "Mr Younes Tsouli",
			phone: "+212639158209",
			email: "younesdgc@gmail.com",
			shippingAddress: {
				line1: "Lot. Rita LOT C Immeuble B",
				line2: "Appartement 17, 610 Bouznika Ouest",
				city: "Bouznika",
				region: "Ben Slimane",
				postalCode: "13100",
				country: "Morocco",
			},
		},
		requirements: {
			purpose: "primary_development_and_ai_work",
			notes: [
				"heavy daily use for software development and autonomous agent work",
				"must prioritize GPU performance within budget",
			],
		},
		items: [
			{
				category: "laptop",
				name: "Acer Nitro 5",
				preferredCpu: "AMD Ryzen 7",
				preferredGpu: "NVIDIA RTX 4060",
				minRamGb: 16,
				minPrimarySsdGb: 512,
				brandPreferences: {
					primaryStorageBrand: "Western Digital",
				},
				internalStorageLayout: [
					{
						slot: "primary",
						type: "ssd_nvme",
						brand: "Western Digital",
						minSizeGb: 1000,
						role: "os_and_apps",
					},
					{
						slot: "secondary",
						type: "ssd_or_hdd",
						brand: "Western Digital",
						minSizeGb: 1000,
						role: "projects_and_datasets",
					},
				],
				warranty: {
					minYears: 2,
					requireOnsiteOrPickup: true,
				},
			},
			{
				category: "accessory",
				name: "laptop_backpack_or_bag",
				requirements: {
					fitsInches: 15.6,
					waterResistant: true,
					paddingLevel: "high",
				},
			},
			{
				category: "accessory",
				name: "wireless_mouse",
				requirements: {
					connection: "2.4ghz_or_bluetooth",
					use: "productivity",
					handedness: "right_or_ambidextrous",
				},
			},
		],
		constraints: {
			currency: "MAD",
			maxBudgetApprox: 30000,
			priority: "high",
			unitEconomicsGuardrails: true,
		},
	};
}

function main() {
	const dir = ensureDir("exports/procurement-requests");
	const req = buildRequest();
	const tsSafe = req.requestedAt.replace(/[:.]/g, "-");
	const fileName = `owner-laptop-request-acer-nitro5-${tsSafe}.json`;
	const filePath = path.join(dir, fileName);
	const payload = JSON.stringify(req, null, 2);
	fs.writeFileSync(filePath, payload, "utf8");
	console.log("Owner procurement request written to", filePath);
}

main();
