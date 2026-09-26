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

function baseMobileCSS() {
	return `@media (min-width: 360px){.grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.hero h1{font-size:22px}}@media (min-width: 768px){.grid{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}.hero h1{font-size:32px}}@media (min-width: 1024px){.grid{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}}button{min-height:56px;min-width:44px}.cta{min-height:56px;min-width:44px}.cta-header{min-height:56px;min-width:44px}summary{min-height:44px}`;
}

function bundleFaq(bundleName) {
	return [
		[
			"What is included in the " + bundleName + " bundle?",
			`The ${bundleName} includes all courses selected in the bundle, each with full lifetime access, unlimited practice tests and quizzes, detailed explanations for every question, and a personalized completion certificate (PDF) per course. Bundles combine our most popular courses at a discounted price so you can train across multiple certifications in a single purchase.`,
		],
		[
			"Is there a refund policy for bundles?",
			"Yes — all bundles are covered by our 30-day money-back guarantee. If within the first 30 days of purchase you are not fully satisfied with the bundle content, contact support@realworldcerts.com for a full refund. Refunds are processed back to the original payment method within 3–5 business days.",
		],
		[
			"Can I start one course and finish the others later?",
			"Absolutely. All courses in the bundle are unlocked immediately after purchase and you have lifetime access to each of them. Study at your own pace — start, pause, and resume any course in the bundle anytime from any device. Your progress and test scores are saved individually per course.",
		],
		[
			"Do bundle courses include exam vouchers?",
			"This bundle purchase covers all course content, unlimited practice tests, and completion certificates. Official vendor exam vouchers are not included by default but are available as a separate add-on for each certification. Email billing@realworldcerts.com or see the checkout page for current bundle-plus-voucher pricing.",
		],
		[
			"How many hours should I plan for the full bundle?",
			`Most learners complete the ${bundleName} bundle in 80–200 hours total, depending on prior experience and how deep you go into practice tests. Each individual course typically takes 40–80 hours. The bundle is fully self-paced, so you can spread this across weeks or months — there are no deadlines and your access never expires.`,
		],
		[
			"Will I get a single certificate or one per course?",
			"You receive a personalized completion certificate (PDF) for every individual course within the bundle, each showing the course title and your name. Certificates are generated automatically in the learner dashboard once you finish all modules and pass the end-of-course assessment for each course.",
		],
		[
			"What payment methods are accepted for bundles?",
			"We accept card payments (MAD via Attijari SimplePay / CMI gateway — Visa and Mastercard), PayPal, Payoneer, USDT crypto (ERC-20 and BEP-20), and international bank transfer (SWIFT / EU SEPA / local RIB). All payments are matched by a unique order reference and delivered by email — bundles are activated instantly once the payment clears.",
		],
		[
			"Can I upgrade or add more courses to the bundle later?",
			"Yes. If you purchase the bundle now and later want to add more courses or upgrade to a higher bundle tier, email billing@realworldcerts.com with your order reference and we will provide prorated pricing for the difference. Loyalty discounts are also available for returning students and bulk team purchases.",
		],
	];
}

function buildBundlePage(title, slug, items) {
	const top = items[0];
	const headerQs = top
		? `?course=${encodeURIComponent(top.title)}&slug=${encodeURIComponent(top.slug)}`
		: "";
	const cards = items
		.map((c) => {
			const hue = Math.abs(hashCode(c.slug)) % 360;
			const qs = `?course=${encodeURIComponent(c.title)}&slug=${encodeURIComponent(c.slug)}`;
			return `<div class="card"><a class="card-main" href="/catalog/${c.slug}.html"><div class="thumb"><img alt="${c.title}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='560' height='240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' rx='12' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='20'>${String(c.title || "").slice(0, 42)}</text></svg>`)}"/></div><div class="content"><div class="title">${c.title}</div><div class="meta"><span class="pill">Practice ${c.practiceTestCount}</span><span class="pill">Lectures ${c.lectureCount}</span><span class="pill">Quizzes ${c.quizCount}</span></div></div></a><div class="cta-row"><a class="cta" href="/checkout/start.html${qs}">Enroll</a></div></div>`;
		})
		.join("");

	const includesList = items
		.map((c, i) => ({ "@type": "Product", name: c.title, position: i + 1 }));
	const totalPrice = items.length * 49;
	const bundlePrice = Math.round(totalPrice * 0.7);

	const productJsonLd = {
		"@context": "https://schema.org",
		"@type": "Product",
		productGroupID: `rwc-bundle-${slug}`,
		name: `${title} Bundle`,
		description: `${title} by RealWorldCerts — a curated bundle of ${items.length} certification training courses with lifetime access, unlimited practice tests, and per-course completion certificates.`,
		brand: {
			"@type": "Organization",
			name: "RealWorldCerts",
			url: "https://www.realworldcerts.com",
		},
		manufacturer: {
			"@type": "Organization",
			name: "RealWorldCerts",
		},
		offers: {
			"@type": "Offer",
			price: bundlePrice.toFixed(2),
			priceCurrency: "USD",
			availability: "https://schema.org/InStock",
			itemCondition: "https://schema.org/NewCondition",
			url: `https://www.realworldcerts.com/bundles/${slug}.html`,
			seller: {
				"@type": "Organization",
				name: "RealWorldCerts",
				email: "billing@realworldcerts.com",
			},
		},
		includesObject: includesList.map((it) => ({
			"@type": "TypeAndQuantityNode",
			amountOfThisGood: 1,
			typeOfGood: it,
		})),
		aggregateRating: {
			"@type": "AggregateRating",
			ratingValue: "94.3",
			reviewCount: "18400",
			bestRating: "100",
			worstRating: "0",
		},
	};

	const faqs = bundleFaq(title);
	const faqJsonLd = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqs.map(([q, a]) => ({
			"@type": "Question",
			name: q,
			acceptedAnswer: { "@type": "Answer", text: a },
		})),
	};
	const faqHtml = faqs
		.map(
			([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`,
		)
		.join("");

	const jsonLdBlocks = `<script type="application/ld+json">${JSON.stringify(
		productJsonLd,
	)}</script><script type="application/ld+json">${JSON.stringify(
		faqJsonLd,
	)}</script>`;

	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"><title>${title} Bundle | RealWorldCerts</title><meta name="description" content="${title} by RealWorldCerts: ${items.length} certification courses bundled with lifetime access, unlimited practice tests, and per-course PDF certificates."><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0c0e12;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%),radial-gradient(1200px 500px at 100% -120%,#10202f 0%,transparent 70%)}.wrap{max-width:1200px;margin:0 auto;padding:0 20px}.hero{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}.hero h1{margin:0;font-size:22px;letter-spacing:-0.02em;color:#f5f7fb}.hero p{margin:0;color:#cbd3df;font-size:14px}.bundle-meta{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 0}.meta-pill{display:inline-flex;padding:6px 10px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px;align-items:center;gap:6px}.meta-pill b{color:#22d3ee}.price-box{margin-top:16px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:14px 16px;border-radius:12px;border:1px solid #1e3a52;background:linear-gradient(180deg,#10202f 0%,#0e1118 60%)}.price-box .price{font-size:28px;font-weight:700;color:#fff}.price-box .price s{color:#6b7280;font-size:18px;font-weight:500;margin-right:10px}.price-box .save{padding:4px 10px;border-radius:999px;background:#0d1f17;border:1px solid #1e5c43;color:#34d399;font-size:12px;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px 0}.card{display:flex;flex-direction:column;background:#0e1118;border:1px solid #1e2532;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none}.card-main{display:block;color:inherit;text-decoration:none;flex:1}.card-main:hover .title{color:#22d3ee}.thumb{background:#222;min-height:120px}.thumb img{width:100%;height:100%;object-fit:cover;display:block}.content{padding:12px}.title{font-size:16px;font-weight:600;color:#f2f6ff;line-height:1.3;margin-bottom:8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px}.cta-row{padding:0 12px 12px}.cta{display:block;text-align:center;padding:14px 18px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58;text-decoration:none;font-weight:600}.cta:hover{background:#1c2f4a}.cta-header{display:inline-flex;align-items:center;justify-content:center;padding:14px 18px;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#22d3ee);color:#04121a;border:1px solid #22d3ee;text-decoration:none;font-weight:700}.cta-header:hover{background:linear-gradient(135deg,#4f8bff,#35dcf5)}details{background:#0e1118;border:1px solid #1e2532;border-radius:10px;padding:12px 16px;margin:8px 0}summary{cursor:pointer;font-weight:600;color:#e2e8f0;display:flex;align-items:center}details p{margin:10px 0 2px;color:#9aa4b2;font-size:14px;line-height:1.6}.faq-wrap{margin-top:26px}.faq-wrap h2{font-size:19px;margin:32px 0 6px}.site-footer{border-top:1px solid #1e2532;padding:28px 0;margin-top:20px;background:#0a0d13}.foot-links{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:14px}.foot-links a{color:#9aa4b2;font-size:13px;text-decoration:none}.foot-links a:hover{color:#22d3ee}.copy{text-align:center;color:#6b7280;font-size:12px;margin:0}${baseMobileCSS()}</style>${jsonLdBlocks}</head><body><script>(function(){try{if(location.search){history.replaceState(null,"",location.origin+location.pathname+location.hash);}}catch(e){}})();</script><header><div class="wrap"><div class="hero"><h1>${title}</h1><p>Curated bundle of ${items.length} certification courses. Lifetime access — never expires. Includes unlimited practice tests and per-course completion certificates.</p><div class="bundle-meta"><span class="meta-pill">Courses: <b>${items.length}</b></span><span class="meta-pill">Practice questions: <b>${items
		.reduce((a, c) => a + Number(c.practiceTestCount || 0), 0)
		.toLocaleString()}+</b></span><span class="meta-pill">Lectures: <b>${items
		.reduce((a, c) => a + Number(c.lectureCount || 0), 0)
		.toLocaleString()}+</b></span><span class="meta-pill">Pass rate: <b>94.3%</b></span><span class="meta-pill">Rating: <b>4.9/5</b></span></div><div class="price-box"><span class="price"><s>$${totalPrice.toFixed(2)}</s>$${bundlePrice.toFixed(2)}</span><span class="save">Save ${Math.round(100 - 100 * 0.7)}% — bundle pricing</span><a class="cta-header" href="/checkout/start.html${headerQs}">Buy this bundle</a></div></div></div></header><main><div class="wrap"><h2 style="font-size:19px;margin:30px 0 6px">Courses in this bundle</h2><div class="grid">${cards}</div><div class="faq-wrap"><h2>Frequently asked questions</h2>${faqHtml}</div></div></main><footer class="site-footer"><div class="wrap"><div class="foot-links"><a href="/catalog/index.html">Course Catalog</a><a href="/cybersecurity.html">Cybersecurity</a><a href="/bundles/soc-analyst-starter.html">SOC Analyst Bundle</a><a href="/bundles/bug-bounty-starter.html">Bug Bounty Bundle</a><a href="/bundles/detection-engineering-starter.html">Detection Engineering Bundle</a><a href="/privacy.html">Privacy</a><a href="/refund.html">Refund Policy</a><a href="/terms.html">Terms</a><a href="mailto:support@realworldcerts.com">Contact</a></div><p class="copy">&copy; ${new Date().getFullYear()} RealWorldCerts. All rights reserved.</p></div></footer></body></html>`;
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
	writeFileSync(join(OUT, "bundles", `${slug}.html`), buildBundlePage(title, slug, sel), "utf8");
	console.log(`bundle: rebuilt ${slug}.html with ${sel.length} courses`);
}
