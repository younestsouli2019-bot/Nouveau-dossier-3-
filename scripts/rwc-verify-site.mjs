import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STATIC = new URL("../.vercel/output/static", import.meta.url).pathname;
// Windows-safe
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const STATIC2 = join(dirname(fileURLToPath(import.meta.url)), "..", ".vercel", "output", "static");

const root = STATIC2;
let errs = 0;

function checkFile(f) {
	if (!existsSync(join(root, f.replace(/^\//, "")))) {
		console.log(`MISSING: ${f}`);
		errs++;
	}
}

// 1. catalog/index.html image refs
const cat = readFileSync(join(root, "catalog/index.html"), "utf8");
const imgs = [...cat.matchAll(/src="(\/assets\/courses\/[^"]+)"/g)].map((m) => m[1]);
console.log(`catalog card images: ${imgs.length}`);
for (const s of imgs) checkFile(s);

// 2. catalog.json image fields
const catJson = JSON.parse(readFileSync(join(root, "data/catalog.json"), "utf8"));
const noImg = catJson.items.filter((i) => !i.image);
console.log(`catalog.json items: ${catJson.items.length}, missing image field: ${noImg.length}`);
const badImg = catJson.items.filter((i) => i.image && !existsSync(join(root, i.image.replace(/^\//, ""))));
console.log(`catalog.json image refs missing on disk: ${badImg.length}`);
if (badImg.length) badImg.slice(0, 5).forEach((i) => console.log("  bad:", i.image));

// 3. checkout links in course pages exist
let checkoutLinks = 0;
let checkoutMissing = 0;
for (const f of readdirSync(join(root, "catalog")).filter((x) => x.endsWith(".html"))) {
	const html = readFileSync(join(root, "catalog", f), "utf8");
	for (const m of html.matchAll(/href="(\/checkout\/[^"]+)"/g)) {
		checkoutLinks++;
		if (!existsSync(join(root, m[1].split("?")[0].replace(/^\//, "")))) checkoutMissing++;
	}
}
console.log(`course-page checkout links: ${checkoutLinks}, missing targets: ${checkoutMissing}`);

// 4. homepage internal links exist
const home = readFileSync(join(root, "index.html"), "utf8");
const links = [...home.matchAll(/href="(\/[^"#][^"]*)"/g)].map((m) => m[1]);
const seen = new Set();
let homeMissing = 0;
for (const l of links) {
	const clean = l.split("?")[0].split("#")[0];
	if (!clean || seen.has(clean)) continue;
	seen.add(clean);
	if (!existsSync(join(root, clean.replace(/^\//, "")))) {
		console.log(`homepage link missing target: ${clean}`);
		homeMissing++;
	}
}
console.log(`homepage internal links checked: ${seen.size}, missing: ${homeMissing}`);

// 5. checkout pages refs to existing pages
for (const m of ["paypal", "payoneer", "crypto", "bank"]) {
	const html = readFileSync(join(root, "checkout", `${m}.html`), "utf8");
	for (const mm of html.matchAll(/href="(\/[^"#][^"]*)"/g)) {
		const clean = mm[1].split("?")[0];
		if (!clean || /^(mailto:|\/assets\/courses)/.test(clean)) continue;
		if (!existsSync(join(root, clean.replace(/^\//, "")))) {
			console.log(`checkout/${m}.html link missing: ${clean}`);
			errs++;
		}
	}
}

console.log(errs ? `FAILED: ${errs} issues` : "ALL CHECKS PASSED");
