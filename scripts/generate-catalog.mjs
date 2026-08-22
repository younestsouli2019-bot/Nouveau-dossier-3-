import fs from "node:fs";
import path from "node:path";

function exists(p) {
	try {
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
}

function findCourseImage(slug) {
	const root = process.cwd();
	const base = path.resolve(
		root,
		".vercel",
		"output",
		"static",
		"assets",
		"courses",
	);
	const exts = [".webp", ".png", ".jpg", ".jpeg", ".svg"];
	for (const ext of exts) {
		const p = path.join(base, slug + ext);
		if (exists(p)) return "/assets/courses/" + slug + ext;
	}
	return null;
}

function findCourseVideo(slug) {
	const root = process.cwd();
	const base = path.resolve(
		root,
		".vercel",
		"output",
		"static",
		"assets",
		"courses",
	);
	const exts = [".mp4", ".webm"];
	for (const ext of exts) {
		const p = path.join(base, slug + ext);
		if (exists(p)) return "/assets/courses/" + slug + ext;
	}
	return null;
}

function readText(p) {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return "";
	}
}

function parseCsv(txt) {
	const lines = String(txt || "")
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0);
	if (lines.length === 0) return { headers: [], rows: [] };
	function parseLine(line) {
		const out = [];
		let cur = "";
		let inQ = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQ) {
				if (ch === '"' && line[i + 1] === '"') {
					cur += '"';
					i++;
				} else if (ch === '"') {
					inQ = false;
				} else {
					cur += ch;
				}
			} else {
				if (ch === ",") {
					out.push(cur);
					cur = "";
				} else if (ch === '"') {
					inQ = true;
				} else {
					cur += ch;
				}
			}
		}
		out.push(cur);
		return out.map((v) => v.trim());
	}
	const headers = parseLine(lines[0]).map((h) => h.trim());
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const vals = parseLine(lines[i]);
		const obj = {};
		for (let j = 0; j < headers.length; j++)
			obj[headers[j] || `col_${j}`] = vals[j] ?? "";
		rows.push(obj);
	}
	return { headers, rows };
}

function findTitleKey(headers) {
	const keys = ["title", "course", "name", "Course", "Title"];
	for (const k of keys) {
		if (headers.includes(k)) return k;
	}
	return headers[0] || "title";
}

function slugify(s) {
	return (
		String(s || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "course"
	);
}

function readCsvFile(p) {
	const txt = readText(p);
	return parseCsv(txt);
}

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function writeText(p, txt) {
	ensureDir(path.dirname(p));
	fs.writeFileSync(p, txt);
}

function safeJson(s) {
	try {
		return JSON.parse(String(s || ""));
	} catch {
		return null;
	}
}

function buildIndexHtml(items) {
	function thumb(title, slug, w = 560, h = 240) {
		const img = findCourseImage(slug);
		if (img) return img;
		const hue = Math.abs(hashCode(slug)) % 360;
		const txt = String(title || "").slice(0, 48);
		const svg = encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' rx='14' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='22'>${txt}</text></svg>`,
		);
		return `data:image/svg+xml;charset=utf-8,${svg}`;
	}
	const cards = items
		.map((c) => {
			return `<a class="card" href="/catalog/${c.slug}.html"><div class="thumb"><img alt="${c.title}" src="${thumb(c.title, c.slug)}"/></div><div class="content"><div class="title">${c.title}</div><div class="meta"><span class="pill">Lectures ${c.lectureCount}</span><span class="pill">Practice ${c.practiceTestCount}</span><span class="pill">Quizzes ${c.quizCount}</span></div><div class="cta">Open</div></div></a>`;
		})
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"><title>Course Catalog</title><link rel="stylesheet" href="/assets/index-CU3Sjcpi.css"><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b0c10;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%),radial-gradient(1200px 500px at 100% -120%,#10202f 0%,transparent 70%)}.wrap{max-width:1200px;margin:0 auto}.hero{display:flex;flex-direction:column;gap:10px}.hero h1{margin:0;font-size:32px;letter-spacing:-0.02em;color:#f5f7fb}.hero p{margin:0;color:#cbd3df}.actions{margin-top:12px;display:flex;gap:10px}.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid #2a2f3b;background:#12151c;color:#eaeef2;text-decoration:none}.btn.alt{background:#1b2233}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px}.card{display:grid;grid-template-rows:160px auto;background:#0e1118;border:1px solid #1e2532;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease,box-shadow .12s ease}.card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,0.35)}.thumb{background:#222}.thumb img{width:100%;height:auto;display:block}.content{padding:12px}.title{font-size:16px;font-weight:600;color:#f2f6ff;line-height:1.3;margin-bottom:8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px}.cta{display:inline-flex;align-items:center;padding:8px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58}</style></head><body><script>(function(){try{if(location.search){history.replaceState(null,"",location.origin+location.pathname+location.hash);}}catch(e){}})();</script><header><div class="wrap"><div class="hero"><h1>Course Catalog</h1><p>Unique visuals per course; image/video assets auto-detected.</p><div class="actions"><a class="btn" href="/cybersecurity.html">Cybersecurity</a><a class="btn alt" href="/bundles/soc-analyst-starter.html">Bundles</a></div></div></div></header><main><div class="wrap"><div class="grid">${cards}</div></div></main></body></html>`;
}

function buildCourseHtml(c) {
	const n = Number(c.practiceTestCount || 0);
	const placeholders = [];
	for (let i = 0; i < Math.min(n, 12); i++) {
		const hue = Math.abs(hashCode(c.slug) + i * 137) % 360;
		const svg = encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},70%,55%)'/><stop offset='100%' stop-color='hsl(${(hue + 60) % 360},70%,45%)'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='18'>Practice Test ${i + 1}</text></svg>`,
		);
		placeholders.push(
			`<img alt="Practice Test ${i + 1}" src="data:image/svg+xml;charset=utf-8,${svg}" />`,
		);
	}
	const gallery = placeholders.length
		? `<div class="gallery">${placeholders.join("")}</div>`
		: `<p>No practice tests listed.</p>`;
	function hero(title, slug) {
		const img = findCourseImage(slug);
		if (img) return img;
		const hue = Math.abs(hashCode(slug)) % 360;
		const txt = String(title || "").slice(0, 48);
		const svg = encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='36'>${txt}</text></svg>`,
		);
		return `data:image/svg+xml;charset=utf-8,${svg}`;
	}
	const vid = findCourseVideo(c.slug);
	const videoHtml = vid
		? `<section class="box"><h2 class="box-title">Screen Recording</h2><video controls style="width:100%;max-height:520px;border-radius:12px;border:1px solid #1e2532;background:#0e1118" src="${vid}"></video></section>`
		: "";
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"><title>${c.title}</title><link rel="stylesheet" href="/assets/index-CU3Sjcpi.css"><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b0c10;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%)}.wrap{max-width:1100px;margin:0 auto}.hero img{width:100%;height:auto;border-radius:12px;border:1px solid #1e2532}.box{border:1px solid #1e2532;border-radius:12px;padding:16px;background:#0e1118;margin-top:16px}.box-title{margin:0 0 10px}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.gallery img{width:100%;height:auto;border-radius:8px;border:1px solid #1e2532}.payments{display:flex;flex-wrap:wrap;gap:10px}.btn{display:inline-flex;align-items:center;padding:8px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58;text-decoration:none}</style></head><body><script>(function(){try{if	location.search){history.replaceState(null,"",location.origin+location.pathname+location.hash);}}catch(e){}})();</script><header><div class="wrap"><h1>${c.title}</h1><div class="actions" style="margin-top:8px;display:flex;gap:10px"><a class="btn" href="/catalog/index.html">Back</a><a class="btn" href="/bundles/soc-analyst-starter.html">Bundles</a></div></div></header><div class="wrap"><div class="hero"><img alt="${c.title}" src="${hero(c.title, c.slug)}"/></div><section class="box"><p>${c.description || ""}</p><p>Category: ${c.category || ""}</p><div class="meta" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"><span class="pill" style="display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px">Lectures ${c.lectureCount}</span><span class="pill" style="display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px">Practice ${c.practiceTestCount}</span><span class="pill" style="display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px">Quizzes ${c.quizCount}</span></div></section>${videoHtml}<section class="box"><h2 class="box-title">Practice Test Gallery</h2>${gallery}</section><section class="box"><h2 class="box-title">Payments</h2><div class="payments"><a class="btn" href="/checkout/paypal.html">PayPal</a><a class="btn" href="/checkout/payoneer.html">Payoneer</a><a class="btn" href="/checkout/crypto.html">Crypto</a><a class="btn" href="/checkout/bank.html">Bank Wire</a></div></section></div></body></html>`;
}
function buildBugBountyHtml() {
	const rewards = [
		{ s: "Low", r: "$50–$150" },
		{ s: "Medium", r: "$200–$500" },
		{ s: "High", r: "$600–$1,200" },
		{ s: "Critical", r: "$1,500+" },
	];
	const rows = rewards
		.map((x) => `<tr><td>${x.s}</td><td>${x.r}</td></tr>`)
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"><title>Bug Bounty Program</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b0c10;color:#eaeef2}header{padding:28px 20px;background:#11162a}.wrap{max-width:900px;margin:0 auto;padding:20px}.cta{display:inline-flex;align-items:center;padding:8px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58;text-decoration:none}.box{border:1px solid #1e2532;border-radius:12px;padding:16px;background:#0e1118;margin-top:16px}.box h2{margin:0 0 10px}.box p{margin:0 0 10px;color:#cbd3df}.tbl{width:100%;border-collapse:collapse;margin-top:10px}.tbl th,.tbl td{border:1px solid #2a3344;padding:10px;text-align:left}.tbl th{background:#151924;color:#eaeef2}</style></head><body><script>(function(){try{if	location.search){history.replaceState(null,"",location.origin+location.pathname+location.hash);}}catch(e){}})();</script><header><div class="wrap"><h1>Bug Bounty Program</h1><p>Report impactful security vulnerabilities. Responsible disclosure only.</p><a class="cta" href="mailto:security@realworldcerts.com">Submit via Email</a></div></header><main><div class="wrap"><div class="box"><h2>Scope</h2><p>Web properties and payment integrations. Excludes DoS, spam, social engineering. Respect privacy and data protection.</p></div><div class="box"><h2>Rewards</h2><table class="tbl"><thead><tr><th>Severity</th><th>Reward</th></tr></thead><tbody>${rows}</tbody></table><p>Payouts processed after validation and fix. Multiple reports of same issue: first-valid gets reward.</p></div><div class="box"><h2>How to Report</h2><p>Include steps to reproduce, impact, and affected endpoints. No exploitation beyond proof-of-concept. Provide minimal data exposure.</p></div><div class="box"><h2>Note</h2><p>This program is operated separately from our training front (RealWorldCerts). It has independent operations and accounting.</p></div></div></main></body></html>`;
}

function hashCode(s) {
	let h = 0;
	for (let i = 0; i < String(s).length; i++) {
		h = (h << 5) - h + String(s).charCodeAt(i);
		h |= 0;
	}
	return Math.abs(h);
}

function buildCyberPortalTabs(items) {
	function cards(arr) {
		if (!arr.length) return `<p style="color:#666">No items found.</p>`;
		return arr
			.map((c) => {
				const hue = Math.abs(hashCode(c.slug)) % 360;
				return `<a class="card" href="/catalog/${c.slug}.html"><div class="thumb"><img alt="${c.title}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='560' height='240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' rx='12' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='20'>${String(c.title || "").slice(0, 42)}</text></svg>`)}"/></div><div class="content"><div class="title">${c.title}</div><div class="meta"><span class="pill">Practice ${c.practiceTestCount}</span><span class="pill">Lectures ${c.lectureCount}</span><span class="pill">Quizzes ${c.quizCount}</span></div><div class="cta">Start</div></div></a>`;
			})
			.join("");
	}
	const soc = items.filter((i) =>
		/siem|security|soc|incident|threat|gcsa|splunk|elk|elastic|azure security|aws security|exabeam|arcsight|soar|blue team|detection/i.test(
			i.title || "",
		),
	);
	const bounty = items.filter((i) =>
		/bug bounty|bscp|burp|owasp|web app|pentest|ejpt|ecppt|offensive|exploit|ctf/i.test(
			i.title || "",
		),
	);
	const intel = items.filter((i) =>
		/cti|threat intel|intelligence|ioc|mitre|attack|feed/i.test(i.title || ""),
	);
	const forensics = items.filter((i) =>
		/forensics|dfir|memory analysis|malware|reverse/i.test(i.title || ""),
	);
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cybersecurity</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b0c10;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%),radial-gradient(1200px 500px at 100% -120%,#10202f 0%,transparent 70%)}.wrap{max-width:1200px;margin:0 auto}.hero{display:flex;flex-direction:column;gap:10px}.hero h1{margin:0;font-size:32px;letter-spacing:-0.02em;color:#f5f7fb}.hero p{margin:0;color:#cbd3df}.actions{margin-top:12px;display:flex;gap:10px}.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid #2a2f3b;background:#12151c;color:#eaeef2;text-decoration:none}.btn.alt{background:#1b2233}.tabs{display:flex;gap:8px;padding:0 20px;margin-top:16px}.tab{padding:8px 12px;border-radius:999px;border:1px solid #2a2f3b;background:#0f1219;color:#eaeef2;text-decoration:none;cursor:pointer}.tab.active{background:#182235}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px}.card{display:grid;grid-template-rows:160px auto;background:#0e1118;border:1px solid #1e2532;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease,box-shadow .12s ease}.card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,0.35)}.thumb{background:#222}.content{padding:12px}.title{font-size:16px;font-weight:600;color:#f2f6ff;line-height:1.3;margin-bottom:8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px}.cta{display:inline-flex;align-items:center;padding:8px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58}.section{display:none}.section.active{display:block}</style></head><body><header><div class="wrap"><div class="hero"><h1>Cybersecurity</h1><p>Practice, detection engineering, SIEM, SOC, threat intel.</p><div class="actions"><a class="btn" href="/catalog/index.html">Catalog</a><a class="btn alt" href="/">Home</a></div></div><div class="tabs"><button class="tab active" data-key="soc">SOC & SIEM</button><button class="tab" data-key="bounty">Bug Bounty</button><button class="tab" data-key="intel">Threat Intel</button><button class="tab" data-key="forensics">Forensics</button><button class="tab" data-key="writeups">Writeups</button></div></div></header><main><div class="wrap"><div id="section-soc" class="section active"><div class="grid">${cards(soc)}</div></div><div id="section-bounty" class="section"><div class="grid">${cards(bounty)}</div></div><div id="section-intel" class="section"><div class="grid">${cards(intel)}</div></div><div id="section-forensics" class="section"><div class="grid">${cards(forensics)}</div></div><div id="section-writeups" class="section"><div class="grid" id="writeups-grid"></div></div></div></main><script>(function(){var tabs=document.querySelectorAll('.tab');for(var i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(){for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('active');this.classList.add('active');var key=this.getAttribute('data-key');var ids=['soc','bounty','intel','forensics','writeups'];for(var k=0;k<ids.length;k++){var el=document.getElementById('section-'+ids[k]);if(el)el.classList.toggle('active',ids[k]===key)}})}fetch('/data/cyber_writeups.json').then(function(r){return r.json()}).then(function(d){var arr=Array.isArray(d.items)?d.items:[];var grid=document.getElementById('writeups-grid');for(var i=0;i<arr.length;i++){var t=arr[i];var a=document.createElement('a');a.className='card';a.href=t.url;a.target='_blank';var hue=(Math.abs(i*97)%360);var thumb=document.createElement('div');thumb.className='thumb';thumb.style.backgroundImage='linear-gradient(135deg,hsl('+hue+',72%,52%),hsl('+((hue+40)%360)+',68%,46%))';var content=document.createElement('div');content.className='content';var title=document.createElement('div');title.className='title';title.textContent=t.title;var meta=document.createElement('div');meta.className='meta';var p1=document.createElement('span');p1.className='pill';p1.textContent=t.source||'';meta.appendChild(p1);var cta=document.createElement('div');cta.className='cta';cta.textContent='Open';content.appendChild(title);content.appendChild(meta);content.appendChild(cta);a.appendChild(thumb);a.appendChild(content);grid.appendChild(a)}}).catch(function(){})})();</script></body></html>`;
}
function buildCyberPortal(items) {
	const filtered = items.filter((i) =>
		/siem|security|soc|incident|threat|gcsa|splunk|elk|elastic|azure security|aws security|giac|gcih|gds[a]|gcil|exabeam|arcsight|soar|blue team|red team|cti|forensics|osint|detection/i.test(
			i.title || "",
		),
	);
	const cards = filtered
		.map((c) => {
			const hue = Math.abs(hashCode(c.slug)) % 360;
			return `<a class="card" href="/catalog/${c.slug}.html"><div class="thumb"><img alt="${c.title}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='560' height='240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},72%,52%)'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360},68%,46%)'/></linearGradient></defs><rect width='100%' height='100%' rx='12' fill='url(#g)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='20'>${String(c.title || "").slice(0, 42)}</text></svg>`)}"/></div><div class="content"><div class="title">${c.title}</div><div class="meta"><span class="pill">Practice ${c.practiceTestCount}</span><span class="pill">Lectures ${c.lectureCount}</span><span class="pill">Quizzes ${c.quizCount}</span></div><div class="cta">Start</div></div></a>`;
		})
		.join("");
	const empty = `<p style="color:#666">No cybersecurity items found.</p>`;
	const grid = cards || empty;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cybersecurity</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b0c10;color:#eaeef2}header{padding:28px 20px;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%),radial-gradient(1200px 500px at 100% -120%,#10202f 0%,transparent 70%)}.wrap{max-width:1200px;margin:0 auto}.hero{display:flex;flex-direction:column;gap:10px}.hero h1{margin:0;font-size:32px;letter-spacing:-0.02em;color:#f5f7fb}.hero p{margin:0;color:#cbd3df}.actions{margin-top:12px;display:flex;gap:10px}.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid #2a2f3b;background:#12151c;color:#eaeef2;text-decoration:none}.btn.alt{background:#1b2233}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px}.card{display:grid;grid-template-rows:160px auto;background:#0e1118;border:1px solid #1e2532;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease,box-shadow .12s ease}.card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,0.35)}.thumb{background:#222}.content{padding:12px}.title{font-size:16px;font-weight:600;color:#f2f6ff;line-height:1.3;margin-bottom:8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:#cbd3df;font-size:12px}.cta{display:inline-flex;align-items:center;padding:8px 12px;border-radius:8px;background:#16263a;color:#eaf1ff;border:1px solid #2a3e58}</style></head><body><header><div class="wrap"><div class="hero"><h1>Cybersecurity</h1><p>Practice, detection engineering, SIEM, SOC, threat intel.</p><div class="actions"><a class="btn" href="/catalog/index.html">Catalog</a><a class="btn alt" href="/">Home</a></div></div></div></header><main><div class="wrap"><div class="grid">${grid}</div></div></main></body></html>`;
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
function countByTitle(rows, key, title) {
	if (!rows || rows.length === 0) return 0;
	const t = String(title || "")
		.trim()
		.toLowerCase();
	const k = key;
	let n = 0;
	for (const r of rows) {
		const v = String(r[k] || "")
			.trim()
			.toLowerCase();
		if (v && t && v === t) n++;
	}
	return n;
}

function main() {
	const root = process.cwd();
	const dataDir = path.resolve(root, ".qodo", "rank.bak");
	const coursesCsv = path.join(dataDir, "courses.csv");
	const lecturesCsv = path.join(dataDir, "lectures.csv");
	const practiceCsv = path.join(dataDir, "practice_tests.csv");
	const practiceCsvAlt = path.resolve(
		root,
		"rank_mirror",
		"practice_tests.csv",
	);
	const quizzesCsv = path.join(dataDir, "quizzes.csv");
	const { headers: ch, rows: cr } = readCsvFile(coursesCsv);
	const { headers: lh, rows: lr } = readCsvFile(lecturesCsv);
	const { headers: ph, rows: pr1 } = readCsvFile(practiceCsv);
	const { headers: p2h, rows: pr2 } = readCsvFile(practiceCsvAlt);
	const pr = [...(pr1 || []), ...(pr2 || [])];
	const { headers: qh, rows: qr } = readCsvFile(quizzesCsv);
	const titleKey = findTitleKey(ch);
	const lecKey = findTitleKey(lh);
	const prKey = findTitleKey(ph.length ? ph : p2h);
	const qKey = findTitleKey(qh);
	const items = [];
	const languagesSet = new Set();
	for (const r of cr) {
		const title = String(r[titleKey] || "").trim();
		if (!title) continue;
		const slug = slugify(title);
		const category =
			r.category || r.Category || r.subject || r.Subject || r.topics || "";
		const lang =
			r.language || r.Language || r.lang || r.Locale || r.locale || "en";
		const language = String(lang || "en").trim();
		if (language) languagesSet.add(language);
		const description =
			r.description || r.Description || r.summary || r.Summary || "";
		const lectureCount = countByTitle(lr, lecKey, title);
		const practiceTestCount = countByTitle(pr, prKey, title);
		const quizCount = countByTitle(qr, qKey, title);
		items.push({
			title,
			slug,
			category: String(category || ""),
			description: String(description || ""),
			lectureCount,
			practiceTestCount,
			quizCount,
			language,
		});
	}
	const outStatic = path.resolve(root, ".vercel", "output", "static");
	const outCatalogDir = path.join(outStatic, "catalog");
	ensureDir(outCatalogDir);
	writeText(path.join(outCatalogDir, "index.html"), buildIndexHtml(items));
	for (const c of items) {
		writeText(path.join(outCatalogDir, `${c.slug}.html`), buildCourseHtml(c));
	}
	const testsDir = path.join(outStatic, "data", "tests");
	ensureDir(testsDir);
	writeText(
		path.join(outStatic, "cybersecurity.html"),
		buildCyberPortalTabs(items),
	);
	writeText(path.join(outStatic, "bounty", "index.html"), buildBugBountyHtml());
	const bundlesDir = path.join(outStatic, "bundles");
	ensureDir(bundlesDir);
	function pickTop(rx, n) {
		const arr = items.filter((i) => rx.test(i.title || ""));
		arr.sort(
			(a, b) =>
				Number(b.practiceTestCount || 0) - Number(a.practiceTestCount || 0),
		);
		return arr.slice(0, n);
	}
	const socTop = pickTop(
		/siem|soc|splunk|elk|security|incident|gcsa|arcsight|exabeam|soar/i,
		8,
	);
	const bountyTop = pickTop(
		/bug bounty|burp|owasp|pentest|ejpt|ecppt|offensive|exploit|ctf/i,
		8,
	);
	const detectTop = pickTop(
		/detection|blue team|rule|sigma|mitre|attack|intel|ioc/i,
		8,
	);
	writeText(
		path.join(bundlesDir, "soc-analyst-starter.html"),
		buildBundlePage("SOC Analyst Starter", socTop),
	);
	writeText(
		path.join(bundlesDir, "bug-bounty-starter.html"),
		buildBundlePage("Bug Bounty Starter", bountyTop),
	);
	writeText(
		path.join(bundlesDir, "detection-engineering-starter.html"),
		buildBundlePage("Detection Engineering Starter", detectTop),
	);
	writeText(
		path.join(outStatic, "data", "catalog.json"),
		JSON.stringify({ items }, null, 2),
	);
	const languages = Array.from(languagesSet.values()).sort();
	writeText(
		path.join(outStatic, "data", "languages.json"),
		JSON.stringify({ languages }, null, 2),
	);
	const trends = [
		{
			title:
				"Low-cost online courses from StraighterLine now available to Point Park University students",
			url: "https://www.prnewswire.com/news-releases/low-cost-online-courses-from-straighterline-now-available-to-point-park-university-students-302660566.html",
			source: "PR Newswire",
			category: "Online Programs",
			ts: new Date().toISOString(),
		},
		{
			title: "Easiest and hardest Oxbridge courses to get offers for",
			url: "https://thetab.com/2026/01/26/desperate-to-go-to-oxbridge-these-are-the-easiest-and-hardest-courses-to-get-offers-for",
			source: "The Tab",
			category: "Admissions",
			ts: new Date().toISOString(),
		},
		{
			title:
				"Rise in demand for UK undergraduate courses despite fee increases",
			url: "https://www.timeshighereducation.com/news/rise-demand-uk-undergraduate-courses-despite-fee-increases",
			source: "Times Higher Education",
			category: "Higher Education",
			ts: new Date().toISOString(),
		},
	];
	writeText(
		path.join(outStatic, "data", "trends.json"),
		JSON.stringify({ trends }, null, 2),
	);
	const cyberWriteups = [
		{
			title: "Bounty writeups",
			url: "https://securitycipher.com/bounty-writeups/",
			source: "Security Cipher",
			category: "Writeups",
			ts: new Date().toISOString(),
		},
		{
			title: "Industry reports and projections",
			url: "https://cybersecurityventures.com/",
			source: "Cybersecurity Ventures",
			category: "Reports",
			ts: new Date().toISOString(),
		},
	];
	writeText(
		path.join(outStatic, "data", "cyber_writeups.json"),
		JSON.stringify({ items: cyberWriteups }, null, 2),
	);
	const byTitle = new Map();
	for (const r of pr) {
		const t = String(r[prKey] || r[titleKey] || "").trim();
		if (!t) continue;
		const key = t.toLowerCase();
		const arr = byTitle.get(key) || [];
		arr.push(r);
		byTitle.set(key, arr);
	}
	for (const r of items) {
		const t = String(r.title || "")
			.trim()
			.toLowerCase();
		const rows = byTitle.get(t) || [];
		if (!rows.length) continue;
		const questions = [];
		for (const q of rows) {
			const pid =
				String(q.questionId || q.id || "").trim() ||
				String(hashCode(q.prompt || Math.random())).slice(0, 12);
			const promptObj = safeJson(q.prompt);
			const corr = safeJson(q.correctResponse) || [];
			const question = promptObj?.question
				? String(promptObj.question)
				: String(q.prompt || "");
			const answers =
				promptObj && Array.isArray(promptObj.answers) ? promptObj.answers : [];
			const feedbacks =
				promptObj && Array.isArray(promptObj.feedbacks)
					? promptObj.feedbacks
					: [];
			const explanation = promptObj?.explanation
				? String(promptObj.explanation)
				: "";
			questions.push({
				id: pid,
				type: String(q.question_type || "multiple-choice"),
				question,
				answers,
				feedbacks,
				explanation,
				correct: corr,
			});
		}
		const testJson = {
			title: r.title,
			slug: r.slug,
			questions,
		};
		writeText(
			path.join(testsDir, `${r.slug}.json`),
			JSON.stringify(testJson, null, 2),
		);
	}
	process.stdout.write(
		`${JSON.stringify({ ok: true, items: items.length, dir: outCatalogDir })}\n`,
	);
}

main();
