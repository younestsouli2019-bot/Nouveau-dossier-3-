import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, ".vercel", "output", "static");

function hashCode(s) {
	let h = 0;
	for (let i = 0; i < String(s).length; i++) {
		h = (h << 5) - h + String(s).charCodeAt(i);
		h |= 0;
	}
	return Math.abs(h);
}

function buildBundlePage(title, items) {
	const top = items[0];
	const headerQs = top
		? `?course=${encodeURIComponent(top.title)}&slug=${encodeURIComponent(top.slug)}`
		: "";
	const cards = items
		.map((c) => {
			const hue = Math.abs(hashCode(c.slug)) % 360;
			const qs = `?course=${encodeURIComponent(c.title)}&slug=${encodeURIComponent(c.slug)}`;
			return `<div class="card"><a class="card-main" href="/catalog/${c.slug}.html"><div class="thumb"><img alt="${c.title}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='560' height='240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' rx='12' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='20'>${String(c.title || "").slice(0, 42)}</text></svg>`)}"/></div><div class="content"><div class="title">${c.title}</div><div class="meta"><span class="pill">Practice ${c.practiceTestCount}</span><span class="pill">Lectures ${c.lectureCount}</span><span class="pill">Quizzes ${c.quizCount}</span></div></div></a><div class="cta-row"><a class="cta" href="/checkout/paypal.html${qs}">Enroll</a></div></div>`;
		})
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"><title>${title}</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0c0e12;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%)}.wrap{max-width:1200px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px}.card{display:flex;flex-direction:column;background:#0e1118;border:1px solid #1e2532;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none}.card-main{display:block;color:inherit;text-decoration:none;flex:1}.card-main:hover .title{color:#22d3ee}.thumb{background:#222}.thumb img{width:100%;height:auto;display:block}.content{padding:12px}.title{font-size:16px;font-weight:600;color:#f2f6ff;line-height:1.3;margin-bottom:8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px}.cta-row{padding:0 12px 12px}.cta{display:block;text-align:center;padding:9px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58;text-decoration:none;font-weight:600}.cta:hover{background:#1c2f4a}.cta-header{display:inline-flex;align-items:center;padding:9px 14px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58;text-decoration:none;font-weight:600}.cta-header:hover{background:#1c2f4a}</style></head><body><script>(function(){try{if(location.search){history.replaceState(null,"",location.origin+location.pathname+location.hash);}}catch(e){}})();</script><header><div class="wrap"><h1>${title}</h1><div style="margin-top:10px"><a class="cta-header" href="/checkout/paypal.html${headerQs}">Checkout</a></div></div></header><main><div class="wrap"><div class="grid">${cards}</div></div></main></body></html>`;
}

function pickTop(items, rx, n) {
	const arr = items.filter((i) => rx.test(i.title || ""));
	arr.sort((a, b) => Number(b.practiceTestCount || 0) - Number(a.practiceTestCount || 0));
	return arr.slice(0, n);
}

const data = JSON.parse(readFileSync(join(OUT, "data", "catalog.json"), "utf8"));
const items = Array.isArray(data.items) ? data.items : [];

const bundles = [
	[
		"soc-analyst-starter",
		"SOC Analyst Starter",
		/siem|soc|splunk|elk|security|incident|gcsa|arcsight|exabeam|soar/i,
	],
	[
		"bug-bounty-starter",
		"Bug Bounty Starter",
		/bug bounty|burp|owasp|pentest|ejpt|ecppt|offensive|exploit|ctf/i,
	],
	[
		"detection-engineering-starter",
		"Detection Engineering Starter",
		/detection|blue team|rule|sigma|mitre|attack|intel|ioc/i,
	],
];

mkdirSync(join(OUT, "bundles"), { recursive: true });
for (const [slug, title, rx] of bundles) {
	const sel = pickTop(items, rx, 8);
	writeFileSync(join(OUT, "bundles", `${slug}.html`), buildBundlePage(title, sel), "utf8");
	console.log(`bundle: rebuilt ${slug}.html with ${sel.length} courses`);
}
