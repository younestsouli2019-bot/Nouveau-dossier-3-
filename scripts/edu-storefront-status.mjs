import { listStorefronts } from "../src/edu/storefront-registry.mjs";

const enabled = listStorefronts({ enabledOnly: true });
console.log(
	JSON.stringify(
		{
			total: listStorefronts().length,
			enabled: enabled.length,
			storefronts: enabled.map((s) => ({ id: s.id, label: s.label, url: s.url, primary: s.primary })),
			primary: listStorefronts().find((s) => s.primary)?.url ?? null,
		},
		null,
		2,
	),
);
