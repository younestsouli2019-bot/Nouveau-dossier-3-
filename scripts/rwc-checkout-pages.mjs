import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = join(ROOT, ".vercel", "output", "static", "checkout");

const STEPS = {
	paypal: [
		["Start your order", "From the secure checkout, choose <strong>PayPal</strong> and provide your email — we send you the exact payment details and your order reference by email."],
		["Send the payment", "Send the amount from your order summary to the PayPal email we provide, and include your <strong>Order Reference</strong> in the note/memo field."],
		["Confirm your order", "Email <strong>billing@realworldcerts.com</strong> once sent if your payment doesn't carry a note field."],
		["We verify &amp; deliver", "We monitor incoming payments and email your course access link automatically once your order is matched."],
	],
	payoneer: [
		["Request a payment request", "From the secure checkout, choose <strong>Payoneer</strong> and provide your email — we send you a payment request for the exact amount in your order summary."],
		["Add your order reference", "Include the <strong>Order Reference</strong> from your payment email in the payment details."],
		["We verify &amp; deliver", "Once the transfer arrives, we verify it against your order and email your course access within 24 hours."],
	],
	crypto: [
		["Pick your network", "We recommend <strong>TRC-20 (Tron)</strong> — lowest fee and fastest confirmation. BEP-20 and ERC-20 also work. Your wallet pays the network fee: usually under $1 on TRC-20, a few dollars on ERC-20. The fee is charged by the network, not by us."],
		["Copy your exact amount", "Your order summary shows an <strong>exact amount</strong> (e.g. 19.4060 USDT). Send that exact amount — it identifies your course automatically. Do not round it."],
		["Scan or paste, then send", "Scan the QR code for your network (or copy the address) and send the exact amount. Some wallets (Bitget Wallet, Trust, TokenPocket) can pay the fee straight from your USDT balance."],
		["Confirmation &amp; order reference", "Crypto confirmations take a few minutes. Keep your <strong>Order Reference</strong> — email it to billing@realworldcerts.com with your email if you want a receipt."],
		["We verify &amp; deliver", "Crypto confirmations take a few minutes. We verify the on-chain transaction and email your course access."],
	],
	bank: [
		["Request bank details", "From the secure checkout, choose <strong>Bank transfer</strong> and provide your email — we email you the bank details, the exact amount, and your unique <strong>Order Reference</strong>."],
		["Make the transfer", "Transfer the amount from your payment email, and put your <strong>Order Reference</strong> in the transfer description."],
		["Send us the receipt", "Email the transfer confirmation or screenshot to <strong>billing@realworldcerts.com</strong> with your order reference."],
		["We verify &amp; deliver", "International transfers can take 1–5 business days. Once cleared, we email your course access."],
	],
};

const DETAILS = {
	paypal: {
		label: "Send payment to",
		value: "Sent to your email after you start checkout",
		note: "Your unique payment email and order reference are emailed to you.",
		icon: "P",
	},
	payoneer: {
		label: "Payoneer payment request",
		value: "Requested via email",
		note: "We send a Payoneer payment request to the email you provide.",
		icon: "P",
	},
	crypto: {
		label: "USDT deposit address (TRC-20 recommended)",
		value: "TUtM17RZ1jCrXPnLa34o7J59BSEqgqYYBE",
		note: "TRC-20 (Tron) — recommended: network fee usually under $1. BEP-20/ERC-20: 0x2700732a6f050c10c080154ce73cc641c448b704 (same address for both).",
		icon: "₮",
		extra: true,
	},
	bank: {
		label: "Bank transfer details",
		value: "Sent to your email after you start checkout",
		note: "Bank details and your unique order reference are emailed to you.",
		icon: "🏦",
	},
};

const FAQ = [
	[
		"What is your refund policy?",
		"We offer a 30-day money-back guarantee on all courses. If you are not satisfied with your purchase within the first 30 days, email billing@realworldcerts.com for a full refund — no questions asked. Refunds are processed back to the original payment method within 3–5 business days.",
	],
	[
		"How many hours should I study per course?",
		"We recommend 40–80 hours of study depending on your prior experience. All courses are self-paced, so you can adjust the timeline to fit your schedule. Every module includes guided lectures, practice tests, and detailed explanations to reinforce learning.",
	],
	[
		"Can I retake the practice tests and quizzes?",
		"Yes — all practice tests, quizzes, and module exams can be retaken an unlimited number of times. Your progress is saved, and every answer has a detailed explanation so you can review weak areas before retrying. No retake fees or limits.",
	],
	[
		"Is an official exam voucher included?",
		"This purchase covers the full course, unlimited practice tests, and a completion certificate (PDF). Official vendor exam vouchers are not included by default but are available as a separate add-on. See the checkout page or email support@realworldcerts.com for current bundle and voucher pricing.",
	],
	[
		"What payment methods are accepted and how are they processed?",
		"We accept card payments (MAD via Attijari SimplePay / CMI gateway — Visa and Mastercard), PayPal, Payoneer, USDT crypto (ERC-20 and BEP-20), and international bank transfer (SWIFT / EU SEPA / local RIB). All card payments are processed through our PCI-DSS compliant gateway — we never store card numbers on our servers.",
	],
	[
		"When will I receive access and how is content delivered?",
		"Access is delivered instantly by email once your payment is matched: PayPal and crypto within minutes to a few hours; Payoneer and bank transfers within 1–5 business days depending on clearing. You receive a secure login link to the learner dashboard where all lectures, practice tests, and resources are available 24/7 from any device.",
	],
	[
		"How do you handle my privacy and personal data?",
		"We collect only the minimum data necessary to process your order (email, payment reference, and optional billing contact). We never sell or share your information. Your data is encrypted at rest and in transit, stored in EU and US-based GDPR-compliant infrastructure. You can request access, correction, or full deletion at any time by emailing privacy@realworldcerts.com — see our Privacy Policy for full details.",
	],
	[
		"Are your processing and data practices GDPR compliant?",
		"Yes. RealWorldCerts operates in compliance with EU GDPR, UK GDPR, PSD2/SCA strong customer authentication for card payments, and SWIFT/EU bank transfer regulations. We maintain a Data Processing Agreement with all sub-processors, perform quarterly security audits, and keep incident-response and breach-notification procedures aligned with Article 33 of the GDPR. Our appointed data protection contact is privacy@realworldcerts.com.",
	],
];

const METHOD_TITLES = { paypal: "PayPal", payoneer: "Payoneer", crypto: "Crypto (USDT)", bank: "Bank Transfer" };

function baseMobileCSS() {
	return `@media (min-width: 360px){.course{flex-direction:column;gap:12px}.course img{width:100%;height:auto;max-height:160px;object-fit:cover}}@media (min-width: 768px){.course{flex-direction:row}.course img{width:168px;height:72px}}@media (min-width: 1024px){main{max-width:900px}.grid{gap:32px}}button{min-height:56px;min-width:44px}.cta{min-height:56px;min-width:44px}.method{min-height:64px}.tab{min-height:44px}.stepper .step{min-height:44px}`;
}

function buildStepper(activeIndex) {
	const steps = ["Review", "Method", "Pay", "Confirm"];
	return `<div class="stepper" role="navigation" aria-label="Checkout progress">${steps
		.map(
			(s, i) =>
				`<div class="step ${i === activeIndex ? "active" : ""} ${
					i < activeIndex ? "done" : ""
				}"><span class="step-num">${i + 1}</span><span class="step-label">${s}</span></div>`,
		)
		.join("")}</div>`;
}

function checkoutJsonLd(pageName, methodLabel, stepLabel) {
	const checkoutAction = {
		"@context": "https://schema.org",
		"@type": "CheckoutAction",
		actionStatus: "https://schema.org/PotentialActionStatus",
		agent: {
			"@type": "Organization",
			name: "RealWorldCerts",
			url: "https://www.realworldcerts.com",
		},
		object: {
			"@type": "Order",
			merchant: {
				"@type": "Organization",
				name: "RealWorldCerts",
				email: "billing@realworldcerts.com",
				url: "https://www.realworldcerts.com",
			},
			orderStatus: "https://schema.org/OrderProcessing",
			paymentMethod: methodLabel || "https://schema.org/PaymentMethod",
			acceptedOffer: {
				"@type": "Offer",
				itemOffered: {
					"@type": "Product",
					name: "RealWorldCerts Certification Training Course",
				},
				priceCurrency: "USD",
				availability: "https://schema.org/InStock",
				seller: {
					"@type": "Organization",
					name: "RealWorldCerts",
				},
			},
		},
	};
	const orderAction = {
		"@context": "https://schema.org",
		"@type": "OrderAction",
		actionStatus: "https://schema.org/PotentialActionStatus",
		result: {
			"@type": "Order",
			orderStatus: "https://schema.org/OrderProcessing",
			confirmationNumber: "RWC-" + new Date().getFullYear().toString().slice(-2) + "XXXX-XXXXXX",
		},
	};
	return `<script type="application/ld+json">${JSON.stringify(
		checkoutAction,
	)}</script><script type="application/ld+json">${JSON.stringify(
		orderAction,
	)}</script>`;
}

function startPage(apiBase) {
	const faq = FAQ.map(
		([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`,
	).join("");

	const jsonLdBlocks = checkoutJsonLd("Secure Checkout Start", "https://schema.org/PaymentCard", "Review → Method");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Checkout · RealWorldCerts</title>
<meta name="description" content="Complete your RealWorldCerts purchase securely. Pay by card (MAD via Attijari SimplePay), PayPal, USDT, or bank transfer. Lifetime access delivered by email.">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${apiBase}; form-action 'self' https://payment.cmi.co.ma https://testpayment.cmi.co.ma ${apiBase}; base-uri 'none'; frame-ancestors 'none'">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{--bg:#0b0c10;--panel:#0e1118;--panel2:#111827;--border:#1e2532;--text:#eaeef2;--muted:#9aa4b2;--accent:#3b82f6;--accent2:#22d3ee;--green:#34d399;--red:#f87171}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Ubuntu,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
a{color:var(--accent2);text-decoration:none}
a:hover{text-decoration:underline}
header{position:sticky;top:0;z-index:10;background:rgba(11,12,16,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.header-in{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:700;font-size:18px;color:#fff;letter-spacing:.2px}
.brand span{color:var(--accent2)}
.back{color:var(--muted);font-size:14px}
main{max-width:720px;margin:0 auto;padding:24px 20px 60px}
.stepper{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:22px}
.stepper .step{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 6px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--muted);font-size:12px;text-align:center}
.stepper .step .step-num{width:28px;height:28px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:var(--muted);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.stepper .step.active{border-color:#2a3e58;background:#16263a;color:var(--text)}
.stepper .step.active .step-num{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:var(--accent2);color:#04121a}
.stepper .step.done{color:var(--green)}
.stepper .step.done .step-num{background:#0d1f17;border-color:#1e5c43;color:var(--green)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px}
.card h2{margin:0 0 16px;font-size:19px}
.course{display:flex;gap:14px}
.course img{width:168px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--border)}
.course .t h3{margin:0 0 4px;font-size:15px;line-height:1.3}
.course .t p{margin:0;color:var(--muted);font-size:13px}
ul.what{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:8px}
ul.what li{display:flex;gap:8px;font-size:14px;color:#cdd6e1}
ul.what li::before{content:"✓";color:var(--green);font-weight:700}
.price{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);margin-top:16px;padding-top:14px;font-size:14px;color:var(--muted)}
.price .amt{font-size:22px;font-weight:700;color:#fff}
.networks code{display:block;margin-top:6px;font-size:12px;word-break:break-all;color:var(--accent,#7cc0ff)}
.qr{width:120px;height:120px;background:#fff;padding:8px;border-radius:8px;margin-top:10px}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:18px 0 6px}
input[type=email]{width:100%;padding:14px 16px;border-radius:10px;border:1px solid #2a3344;background:#0a0d13;color:#fff;font:inherit;font-size:15px;min-height:56px}
input[type=email]:focus{outline:none;border-color:var(--accent)}
.methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.method{border:1px solid #2a3344;background:var(--panel2);border-radius:10px;padding:12px;cursor:pointer;color:var(--text);text-align:left;font:inherit}
.method.sel{border-color:var(--accent2);background:#16263a}
.method strong{display:block;font-size:14px}
.method span{font-size:12px;color:var(--muted)}
.cta{margin-top:18px;width:100%;padding:16px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#04121a;font-weight:700;font-size:15px;cursor:pointer}
.cta:disabled{opacity:.6;cursor:not-allowed}
.msg{display:none;margin-top:12px;padding:10px 12px;border-radius:8px;font-size:13px}
.msg.err{border:1px solid #7a3b3b;background:#1d1212;color:var(--red)}
.msg.ok{border:1px solid #1e5c43;background:#0d1f17;color:var(--green)}
.trust{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.trust span{font-size:12px;color:var(--muted);border:1px solid var(--border);padding:6px 10px;border-radius:999px;background:var(--panel2)}
.alt{margin-top:18px;font-size:13px;color:var(--muted)}
.alt a{text-decoration:underline}
details{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin:8px 0}
summary{cursor:pointer;font-weight:600;color:#e2e8f0;min-height:44px;display:flex;align-items:center}
details p{margin:10px 0 2px;color:var(--muted);font-size:14px;line-height:1.6}
footer{border-top:1px solid var(--border);padding:26px 20px;color:var(--muted);font-size:13px}
.foot-in{max-width:1040px;margin:0 auto;display:flex;gap:18px;flex-wrap:wrap}
.faq-section{margin-top:26px}
.faq-section h2{font-size:19px;margin:32px 0 6px}
${baseMobileCSS()}
</style>
${jsonLdBlocks}
</head>
<body>
<header><div class="header-in"><a class="brand" href="/">RealWorld<span>Certs</span></a><a class="back" href="/catalog/index.html">← Back to catalog</a></div></header>
<main>
  ${buildStepper(1)}
  <section class="card">
    <h2>Secure checkout</h2>
    <div class="course">
      <img id="courseImg" src="/assets/courses/oscp-certification-exam.svg" alt="Course image">
      <div class="t"><h3 id="courseTitle">Your selected course</h3><p id="courseMeta">Practice tests with detailed explanations</p></div>
    </div>
    <ul class="what">
      <li>Full practice-test bank with explanations</li>
      <li>Lifetime access from any device</li>
      <li>Completion certificate (PDF)</li>
      <li>Email support &amp; exam tips</li>
    </ul>
    <div class="price"><span>Course price</span><span class="amt" id="amount">Confirmed after you enter your email</span></div>

    <label for="email">Email (for instant delivery)</label>
    <input id="email" type="email" autocomplete="email" placeholder="you@example.com" required>

    <label>Payment method</label>
    <div class="methods" id="methods">
      <div class="method sel" data-method="card"><strong>Card (Visa/Mastercard)</strong><span>Secure Stripe checkout — instant confirmation</span></div>
      <div class="method" data-method="cmi"><strong>Card (MAD)</strong><span>Attijari SimplePay, Visa/Mastercard</span></div>
      <div class="method" data-method="paypal"><strong>PayPal</strong><span>PayPal balance or card</span></div>
      <div class="method" data-method="crypto"><strong>USDT</strong><span>Crypto wallet (ERC-20 / BEP-20)</span></div>
      <div class="method" data-method="bank"><strong>Bank transfer</strong><span>SWIFT or local RIB</span></div>
    </div>

    <button class="cta" id="pay">Continue to payment</button>
    <p class="msg err" id="errMsg"></p>
    <p class="msg ok" id="okMsg">Redirecting you to the secure payment page…</p>
    <div class="trust"><span>✓ 256-bit encrypted checkout</span><span>✓ 30-day money-back guarantee</span><span>✓ No card stored on this site</span></div>
  </section>

  <p class="alt">Prefer a manual method? See instructions for <a href="./paypal.html">PayPal</a>, <a href="./crypto.html">USDT</a>, <a href="./bank.html">bank transfer</a> — these still use your order reference to match the payment. Questions? Email <a href="mailto:billing@realworldcerts.com">billing@realworldcerts.com</a>.</p>

  <div class="faq-section">
    <h2>Frequently asked questions</h2>
    ${faq}
  </div>
</main>
<footer><div class="foot-in"><a href="/catalog/index.html">Course Catalog</a><a href="/cybersecurity.html">Cybersecurity</a><a href="/practice.html">Practice Tests</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a><a href="/refund.html">Refund Policy</a><a href="/terms.html">Terms</a></div></footer>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var course = q.get("course");
  var slug = q.get("slug");
  var amount = q.get("amount");
  var productId = q.get("product_id") || slug || "";
  var emailEl = document.getElementById("email");
  var errEl = document.getElementById("errMsg");
  var okEl = document.getElementById("okMsg");
  var payBtn = document.getElementById("pay");
  if (slug) { var img = document.getElementById("courseImg"); img.src = "/assets/courses/" + encodeURIComponent(slug) + ".svg"; }
  if (course) { document.getElementById("courseTitle").textContent = course; try { fetch("/data/catalog.json").then(function(r){return r.json()}).then(function(d){ var hit = (Array.isArray(d.items)?d.items:[]).find(function(i){return i.slug===slug}); if (hit){ document.getElementById("courseTitle").textContent = hit.title; if(hit.practiceTestCount) document.getElementById("courseMeta").textContent = hit.practiceTestCount + " practice questions with detailed explanations"; }}).catch(function(){}); } catch(e){} }
  if (amount) document.getElementById("amount").textContent = "$" + amount;

  var chosen = "card";
  var methods = Array.prototype.slice.call(document.querySelectorAll(".method"));
  methods.forEach(function(m){ m.addEventListener("click", function(){ chosen = m.getAttribute("data-method"); methods.forEach(function(x){ x.classList.toggle("sel", x===m); }); }); });

  payBtn.addEventListener("click", function(){
    errEl.style.display = "none";
    okEl.style.display = "none";
    var email = emailEl.value.trim();
    if (!email || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { showErr("Please enter a valid email — we deliver course access to it."); return; }
    if (!productId) { showErr("We could not identify your course. Please go back to the course page and try again."); return; }
    payBtn.disabled = true;
    var body = { product_id: productId, method: chosen, email: email };
    if (course) body.course = String(course).slice(0, 120);
    if (slug) body.slug = slug;
    fetch("${apiBase}/api/checkout/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function(res){ return res.json().then(function(d){ return { status: res.status, ok: res.ok, d: d }; }); })
      .then(function(r){
        okEl.style.display = "block";
        if (r.ok && r.d.url) { window.location.href = r.d.url; return; }
        if (r.ok && r.d.form_action && r.d.fields) {
          var f = document.createElement("form");
          f.method = "POST";
          f.action = r.d.form_action;
          f.style.display = "none";
          Object.keys(r.d.fields).forEach(function(k){ var i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = String(r.d.fields[k]); f.appendChild(i); });
          document.body.appendChild(f);
          f.submit();
          return;
        }
        var msg = r.d && r.d.error ? r.d.error : "Payment could not be started right now.";
        if (r.d && r.d.setup) msg += " " + r.d.setup;
        if (r.d && r.d.fallback) msg += " " + r.d.fallback;
        showErr(msg);
        payBtn.disabled = false;
      })
      .catch(function(){ showErr("We could not reach the payment service. Please try again or email billing@realworldcerts.com."); payBtn.disabled = false; });
  });
  function showErr(m){ errEl.textContent = m; errEl.style.display = "block"; }
})();
</script>
</body>
</html>
`;
}

const API_BASE = process.env.RWC_API_BASE || "https://swarm-ops-project.vercel.app";

mkdirSync(OUT, { recursive: true });
for (const m of Object.keys(METHOD_TITLES)) {
	writeFileSync(join(OUT, `${m}.html`), page(m), "utf8");
	console.log(`checkout: wrote ${m}.html`);
}
writeFileSync(join(OUT, "start.html"), startPage(API_BASE), "utf8");
console.log(`checkout: wrote start.html (apiBase=${API_BASE})`);

function thanksPage() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Order confirmed — RealWorldCerts</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0b1220;color:#e6edf3;display:grid;place-items:center;min-height:100vh;padding:24px}
.card{max-width:520px;background:#101a2c;border:1px solid #2a3344;border-radius:14px;padding:32px;text-align:center}
h1{font-size:22px;margin:0 0 12px;color:#22c55e}
p{line-height:1.6;color:#9fb0c3;font-size:15px}
a.cta{display:inline-block;margin-top:20px;padding:12px 22px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="card">
<h1>Payment received ✓</h1>
<p>Your order is confirmed. A receipt is on its way to your email, and your course access follows from our delivery team. Keep an eye on your inbox (and spam folder just in case).</p>
<p>Questions? Email <a href="mailto:billing@realworldcerts.com" style="color:#60a5fa">billing@realworldcerts.com</a>.</p>
<a class="cta" href="/">Back to the catalog</a>
</div>
</body>
</html>
`;
}
writeFileSync(join(OUT, "thanks.html"), thanksPage(), "utf8");
console.log("checkout: wrote thanks.html");

function page(method) {
	const steps = STEPS[method]
		.map(
			(s, i) => `<li><span class="step-num">${i + 1}</span><div><h4>${s[0]}</h4><p>${s[1]}</p></div></li>`,
		)
		.join("");
	const d = DETAILS[method];
	const extra = d.extra
		? `<div class="networks">
		<div class="network rec"><strong>TRC-20</strong><span>Tron — recommended, fee usually under $1</span><code>TUtM17RZ1jCrXPnLa34o7J59BSEqgqYYBE</code><img class="qr" alt="TRC-20 USDT deposit QR code" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0nMS4wJyBlbmNvZGluZz0nVVRGLTgnPz4KPHN2ZyB3aWR0aD0iMTkuOG1tIiBoZWlnaHQ9IjE5LjhtbSIgdmVyc2lvbj0iMS4xIiB2aWV3Qm94PSIwIDAgMTkuOCAxOS44IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xLjIsMS4ySDEuOFYxLjhIMS4yek0xLjgsMS4ySDIuNFYxLjhIMS44ek0yLjQsMS4ySDNWMS44SDIuNHpNMywxLjJIMy42VjEuOEgzek0zLjYsMS4ySDQuMlYxLjhIMy42ek00LjIsMS4ySDQuOFYxLjhINC4yek00LjgsMS4ySDUuNFYxLjhINC44ek02LDEuMkg2LjZWMS44SDZ6TTcuOCwxLjJIOC40VjEuOEg3Ljh6TTksMS4ySDkuNlYxLjhIOXpNOS42LDEuMkgxMC4yVjEuOEg5LjZ6TTEwLjIsMS4ySDEwLjhWMS44SDEwLjJ6TTEyLjYsMS4ySDEzLjJWMS44SDEyLjZ6TTE0LjQsMS4ySDE1VjEuOEgxNC40ek0xNSwxLjJIMTUuNlYxLjhIMTV6TTE1LjYsMS4ySDE2LjJWMS44SDE1LjZ6TTE2LjIsMS4ySDE2LjhWMS44SDE2LjJ6TTE2LjgsMS4ySDE3LjRWMS44SDE2Ljh6TTE3LjQsMS4ySDE4VjEuOEgxNy40ek0xOCwxLjJIMTguNlYxLjhIMTh6TTEuMiwxLjhIMS44VjIuNEgxLjJ6TTQuOCwxLjhINS40VjIuNEg0Ljh6TTYsMS44SDYuNlYyLjRINnpNNy4yLDEuOEg3LjhWMi40SDcuMnpNNy44LDEuOEg4LjRWMi40SDcuOHpNOC40LDEuOEg5VjIuNEg4LjR6TTksMS44SDkuNlYyLjRIOXpNMTAuOCwxLjhIMTEuNFYyLjRIMTAuOHpNMTEuNCwxLjhIMTJWMi40SDExLjR6TTEyLDEuOEgxMi42VjIuNEgxMnpNMTMuMiwxLjhIMTMuOFYyLjRIMTMuMnpNMTQuNCwxLjhIMTVWMi40SDE0LjR6TTE4LDEuOEgxOC42VjIuNEgxOHpNMS4yLDIuNEgxLjhWM0gxLjJ6TTIuNCwyLjRIM1YzSDIuNHpNMywyLjRIMy42VjNIM3pNMy42LDIuNEg0LjJWM0gzLjZ6TTQuOCwyLjRINS40VjNINC44ek02LjYsMi40SDcuMlYzSDYuNnpNNy44LDIuNEg4LjRWM0g3Ljh6TTguNCwyLjRIOVYzSDguNHpNMTAuOCwyLjRIMTEuNFYzSDEwLjh6TTEyLDIuNEgxMi42VjNIMTJ6TTE0LjQsMi40SDE1VjNIMTQuNHpNMTUuNiwyLjRIMTYuMlYzSDE1LjZ6TTE2LjIsMi40SDE2LjhWM0gxNi4yek0xNi44LDIuNEgxNy40VjNIMTYuOHpNMTgsMi40SDE4LjZWM0gxOHpNMS4yLDNIMS44VjMuNkgxLjJ6TTIuNCwzSDNWMy42SDIuNHpNMywzSDMuNlYzLjZIM3pNMy42LDNINC4yVjMuNkgzLjZ6TTQuOCwzSDUuNFYzLjZINC44ek02LDNINi42VjMuNkg2ek03LjIsM0g3LjhWMy42SDcuMnpNOC40LDNIOVYzLjZIOC40ek05LjYsM0gxMC4yVjMuNkg5LjZ6TTEwLjIsM0gxMC44VjMuNkgxMC4yek0xMS40LDNIMTJWMy42SDExLjR6TTEyLDNIMTIuNlYzLjZIMTJ6TTEyLjYsM0gxMy4yVjMuNkgxMi42ek0xNC40LDNIMTVWMy42SDE0LjR6TTE1LjYsM0gxNi4yVjMuNkgxNS42ek0xNi4yLDNIMTYuOFYzLjZIMTYuMnpNMTYuOCwzSDE3LjRWMy42SDE2Ljh6TTE4LDNIMTguNlYzLjZIMTh6TTEuMiwzLjZIMS44VjQuMkgxLjJ6TTIuNCwzLjZIM1Y0LjJIMi40ek0zLDMuNkgzLjZWNC4ySDN6TTMuNiwzLjZINC4yVjQuMkgzLjZ6TTQuOCwzLjZINS40VjQuMkg0Ljh6TTYuNiwzLjZINy4yVjQuMkg2LjZ6TTcuOCwzLjZIOC40VjQuMkg3Ljh6TTguNCwzLjZIOVY0LjJIOC40ek05LjYsMy42SDEwLjJWNC4ySDkuNnpNMTAuOCwzLjZIMTEuNFY0LjJIMTAuOHpNMTIsMy42SDEyLjZWNC4ySDEyek0xNC40LDMuNkgxNVY0LjJIMTQuNHpNMTUuNiwzLjZIMTYuMlY0LjJIMTUuNnpNMTYuMiwzLjZIMTYuOFY0LjJIMTYuMnpNMTYuOCwzLjZIMTcuNFY0LjJIMTYuOHpNMTgsMy42SDE4LjZWNC4ySDE4ek0xLjIsNC4ySDEuOFY0LjhIMS4yek00LjgsNC4ySDUuNFY0LjhINC44ek02LjYsNC4ySDcuMlY0LjhINi42ek03LjgsNC4ySDguNFY0LjhINy44ek04LjQsNC4ySDlWNC44SDguNHpNOSw0LjJIOS42VjQuOEg5ek0xMC4yLDQuMkgxMC44VjQuOEgxMC4yek0xMC44LDQuMkgxMS40VjQuOEgxMC44ek0xMi42LDQuMkgxMy4yVjQuOEgxMi42ek0xMy4yLDQuMkgxMy44VjQuOEgxMy4yek0xNC40LDQuMkgxNVY0LjhIMTQuNHpNMTgsNC4ySDE4LjZWNC44SDE4ek0xLjIsNC44SDEuOFY1LjRIMS4yek0xLjgsNC44SDIuNFY1LjRIMS44ek0yLjQsNC44SDNWNS40SDIuNHpNMyw0LjhIMy42VjUuNEgzek0zLjYsNC44SDQuMlY1LjRIMy42ek00LjIsNC44SDQuOFY1LjRINC4yek00LjgsNC44SDUuNFY1LjRINC44ek02LDQuOEg2LjZWNS40SDZ6TTcuMiw0LjhINy44VjUuNEg3LjJ6TTguNCw0LjhIOVY1LjRIOC40ek05LjYsNC44SDEwLjJWNS40SDkuNnpNMTAuOCw0LjhIMTEuNFY1LjRIMTAuOHpNMTIsNC44SDEyLjZWNS40SDEyek0xMy4yLDQuOEgxMy44VjUuNEgxMy4yek0xNC40LDQuOEgxNVY1LjRIMTQuNHpNMTUsNC44SDE1LjZWNS40SDE1ek0xNS42LDQuOEgxNi4yVjUuNEgxNS42ek0xNi4yLDQuOEgxNi44VjUuNEgxNi4yek0xNi44LDQuOEgxNy40VjUuNEgxNi44ek0xNy40LDQuOEgxOFY1LjRIMTcuNHpNMTgsNC44SDE4LjZWNS40SDE4ek02LDUuNEg2LjZWNkg2ek02LjYsNS40SDcuMlY2SDYuNnpNNy44LDUuNEg4LjRWNkg3Ljh6TTguNCw1LjRIOVY2SDguNHpNMTAuMiw1LjRIMTAuOFY2SDEwLjJ6TTEwLjgsNS40SDExLjRWNkgxMC44ek0xMS40LDUuNEgxMlY2SDExLjR6TTEyLDUuNEgxMi42VjZIMTJ6TTEyLjYsNS40SDEzLjJWNkgxMi42ek0xLjIsNkgxLjhWNi42SDEuMnpNMi40LDZIM1Y2LjZIMi40ek0zLDZIMy42VjYuNkgzek00LjIsNkg0LjhWNi42SDQuMnpNNC44LDZINS40VjYuNkg0Ljh6TTUuNCw2SDZWNi42SDUuNHpNNy4yLDZINy44VjYuNkg3LjJ6TTguNCw2SDlWNi42SDguNHpNOSw2SDkuNlY2LjZIOXpNMTAuMiw2SDEwLjhWNi42SDEwLjJ6TTEwLjgsNkgxMS40VjYuNkgxMC44ek0xMiw2SDEyLjZWNi42SDEyek0xMi42LDZIMTMuMlY2LjZIMTIuNnpNMTMuMiw2SDEzLjhWNi42SDEzLjJ6TTE0LjQsNkgxNVY2LjZIMTQuNHpNMTYuMiw2SDE2LjhWNi42SDE2LjJ6TTE3LjQsNkgxOFY2LjZIMTcuNHpNMTgsNkgxOC42VjYuNkgxOHpNMS4yLDYuNkgxLjhWNy4ySDEuMnpNMS44LDYuNkgyLjRWNy4ySDEuOHpNMi40LDYuNkgzVjcuMkgyLjR6TTMuNiw2LjZINC4yVjcuMkgzLjZ6TTQuMiw2LjZINC44VjcuMkg0LjJ6TTYsNi42SDYuNlY3LjJINnpNOC40LDYuNkg5VjcuMkg4LjR6TTksNi42SDkuNlY3LjJIOXpNOS42LDYuNkgxMC4yVjcuMkg5LjZ6TTEwLjIsNi42SDEwLjhWNy4ySDEwLjJ6TTEyLDYuNkgxMi42VjcuMkgxMnpNMTIuNiw2LjZIMTMuMlY3LjJIMTIuNnpNMTUsNi42SDE1LjZWNy4ySDE1ek0xNS42LDYuNkgxNi4yVjcuMkgxNS42ek0xNi4yLDYuNkgxNi44VjcuMkgxNi4yek0xNi44LDYuNkgxNy40VjcuMkgxNi44ek0xNy40LDYuNkgxOFY3LjJIMTcuNHpNMS4yLDcuMkgxLjhWNy44SDEuMnpNMS44LDcuMkgyLjRWNy44SDEuOHpNMi40LDcuMkgzVjcuOEgyLjR6TTMsNy4ySDMuNlY3LjhIM3pNNC44LDcuMkg1LjRWNy44SDQuOHpNNS40LDcuMkg2VjcuOEg1LjR6TTYsNy4ySDYuNlY3LjhINnpNNy44LDcuMkg4LjRWNy44SDcuOHpNOSw3LjJIOS42VjcuOEg5ek0xMC44LDcuMkgxMS40VjcuOEgxMC44ek0xNC40LDcuMkgxNVY3LjhIMTQuNHpNMTUsNy4ySDE1LjZWNy44SDE1ek0xNS42LDcuMkgxNi4yVjcuOEgxNS42ek0xNi4yLDcuMkgxNi44VjcuOEgxNi4yek0xNi44LDcuMkgxNy40VjcuOEgxNi44ek0xNy40LDcuMkgxOFY3LjhIMTcuNHpNMS4yLDcuOEgxLjhWOC40SDEuMnpNMS44LDcuOEgyLjRWOC40SDEuOHpNMi40LDcuOEgzVjguNEgyLjR6TTMsNy44SDMuNlY4LjRIM3pNNC4yLDcuOEg0LjhWOC40SDQuMnpNNS40LDcuOEg2VjguNEg1LjR6TTYsNy44SDYuNlY4LjRINnpNNi42LDcuOEg3LjJWOC40SDYuNnpNNy4yLDcuOEg3LjhWOC40SDcuMnpNMTMuMiw3LjhIMTMuOFY4LjRIMTMuMnpNMTQuNCw3LjhIMTVWOC40SDE0LjR6TTE2LjIsNy44SDE2LjhWOC40SDE2LjJ6TTE4LDcuOEgxOC42VjguNEgxOHpNMi40LDguNEgzVjlIMi40ek00LjIsOC40SDQuOFY5SDQuMnpNNC44LDguNEg1LjRWOUg0Ljh6TTcuOCw4LjRIOC40VjlINy44ek04LjQsOC40SDlWOUg4LjR6TTkuNiw4LjRIMTAuMlY5SDkuNnpNMTAuMiw4LjRIMTAuOFY5SDEwLjJ6TTEyLjYsOC40SDEzLjJWOUgxMi42ek0xNSw4LjRIMTUuNlY5SDE1ek0xNi4yLDguNEgxNi44VjlIMTYuMnpNMTYuOCw4LjRIMTcuNFY5SDE2Ljh6TTEuOCw5SDIuNFY5LjZIMS44ek0zLDlIMy42VjkuNkgzek0zLjYsOUg0LjJWOS42SDMuNnpNNS40LDlINlY5LjZINS40ek04LjQsOUg5VjkuNkg4LjR6TTkuNiw5SDEwLjJWOS42SDkuNnpNMTAuOCw5SDExLjRWOS42SDEwLjh6TTExLjQsOUgxMlY5LjZIMTEuNHpNMTIsOUgxMi42VjkuNkgxMnpNMTIuNiw5SDEzLjJWOS42SDEyLjZ6TTEzLjgsOUgxNC40VjkuNkgxMy44ek0xNi44LDlIMTcuNFY5LjZIMTYuOHpNMTcuNCw5SDE4VjkuNkgxNy40ek0xOCw5SDE4LjZWOS42SDE4ek0xLjIsOS42SDEuOFYxMC4ySDEuMnpNMyw5LjZIMy42VjEwLjJIM3pNMy42LDkuNkg0LjJWMTAuMkgzLjZ6TTQuOCw5LjZINS40VjEwLjJINC44ek01LjQsOS42SDZWMTAuMkg1LjR6TTksOS42SDkuNlYxMC4ySDl6TTEwLjgsOS42SDExLjRWMTAuMkgxMC44ek0xMS40LDkuNkgxMlYxMC4ySDExLjR6TTEyLjYsOS42SDEzLjJWMTAuMkgxMi42ek0xNC40LDkuNkgxNVYxMC4ySDE0LjR6TTE1LDkuNkgxNS42VjEwLjJIMTV6TTE1LjYsOS42SDE2LjJWMTAuMkgxNS42ek0xNy40LDkuNkgxOFYxMC4ySDE3LjR6TTE4LDkuNkgxOC42VjEwLjJIMTh6TTMsMTAuMkgzLjZWMTAuOEgzek0zLjYsMTAuMkg0LjJWMTAuOEgzLjZ6TTYuNiwxMC4ySDcuMlYxMC44SDYuNnpNNy4yLDEwLjJINy44VjEwLjhINy4yek05LjYsMTAuMkgxMC4yVjEwLjhIOS42ek0xMy4yLDEwLjJIMTMuOFYxMC44SDEzLjJ6TTEzLjgsMTAuMkgxNC40VjEwLjhIMTMuOHpNMTUuNiwxMC4ySDE2LjJWMTAuOEgxNS42ek0zLDEwLjhIMy42VjExLjRIM3pNMy42LDEwLjhINC4yVjExLjRIMy42ek00LjIsMTAuOEg0LjhWMTEuNEg0LjJ6TTQuOCwxMC44SDUuNFYxMS40SDQuOHpNNS40LDEwLjhINlYxMS40SDUuNHpNNiwxMC44SDYuNlYxMS40SDZ6TTYuNiwxMC44SDcuMlYxMS40SDYuNnpNNy44LDEwLjhIOC40VjExLjRINy44ek05LjYsMTAuOEgxMC4yVjExLjRIOS42ek0xMS40LDEwLjhIMTJWMTEuNEgxMS40ek0xMiwxMC44SDEyLjZWMTEuNEgxMnpNMTMuOCwxMC44SDE0LjRWMTEuNEgxMy44ek0xNSwxMC44SDE1LjZWMTEuNEgxNXpNMTYuMiwxMC44SDE2LjhWMTEuNEgxNi4yek0xNy40LDEwLjhIMThWMTEuNEgxNy40ek0xLjgsMTEuNEgyLjRWMTJIMS44ek01LjQsMTEuNEg2VjEySDUuNHpNNy4yLDExLjRINy44VjEySDcuMnpNNy44LDExLjRIOC40VjEySDcuOHpNOS42LDExLjRIMTAuMlYxMkg5LjZ6TTE1LDExLjRIMTUuNlYxMkgxNXpNMTcuNCwxMS40SDE4VjEySDE3LjR6TTE4LDExLjRIMTguNlYxMkgxOHpNMS4yLDEySDEuOFYxMi42SDEuMnpNNC44LDEySDUuNFYxMi42SDQuOHpNOC40LDEySDlWMTIuNkg4LjR6TTksMTJIOS42VjEyLjZIOXpNOS42LDEySDEwLjJWMTIuNkg5LjZ6TTEwLjIsMTJIMTAuOFYxMi42SDEwLjJ6TTEwLjgsMTJIMTEuNFYxMi42SDEwLjh6TTEzLjIsMTJIMTMuOFYxMi42SDEzLjJ6TTE0LjQsMTJIMTVWMTIuNkgxNC40ek0xNi4yLDEySDE2LjhWMTIuNkgxNi4yek0xNi44LDEySDE3LjRWMTIuNkgxNi44ek0zLDEyLjZIMy42VjEzLjJIM3pNMy42LDEyLjZINC4yVjEzLjJIMy42ek00LjIsMTIuNkg0LjhWMTMuMkg0LjJ6TTUuNCwxMi42SDZWMTMuMkg1LjR6TTYuNiwxMi42SDcuMlYxMy4ySDYuNnpNNy4yLDEyLjZINy44VjEzLjJINy4yek03LjgsMTIuNkg4LjRWMTMuMkg3Ljh6TTguNCwxMi42SDlWMTMuMkg4LjR6TTksMTIuNkg5LjZWMTMuMkg5ek05LjYsMTIuNkgxMC4yVjEzLjJIOS42ek0xMS40LDEyLjZIMTJWMTMuMkgxMS40ek0xMiwxMi42SDEyLjZWMTMuMkgxMnpNMTIuNiwxMi42SDEzLjJWMTMuMkgxMi42ek0xMy4yLDEyLjZIMTMuOFYxMy4ySDEzLjJ6TTE0LjQsMTIuNkgxNVYxMy4ySDE0LjR6TTE1LDEyLjZIMTUuNlYxMy4ySDE1ek0xNS42LDEyLjZIMTYuMlYxMy4ySDE1LjZ6TTE2LjIsMTIuNkgxNi44VjEzLjJIMTYuMnpNMTYuOCwxMi42SDE3LjRWMTMuMkgxNi44ek0xLjgsMTMuMkgyLjRWMTMuOEgxLjh6TTMsMTMuMkgzLjZWMTMuOEgzek0zLjYsMTMuMkg0LjJWMTMuOEgzLjZ6TTQuOCwxMy4ySDUuNFYxMy44SDQuOHpNNS40LDEzLjJINlYxMy44SDUuNHpNNiwxMy4ySDYuNlYxMy44SDZ6TTcuMiwxMy4ySDcuOFYxMy44SDcuMnpNOC40LDEzLjJIOVYxMy44SDguNHpNOSwxMy4ySDkuNlYxMy44SDl6TTkuNiwxMy4ySDEwLjJWMTMuOEg5LjZ6TTEwLjIsMTMuMkgxMC44VjEzLjhIMTAuMnpNMTEuNCwxMy4ySDEyVjEzLjhIMTEuNHpNMTIsMTMuMkgxMi42VjEzLjhIMTJ6TTEyLjYsMTMuMkgxMy4yVjEzLjhIMTIuNnpNMTMuMiwxMy4ySDEzLjhWMTMuOEgxMy4yek0xMy44LDEzLjJIMTQuNFYxMy44SDEzLjh6TTE0LjQsMTMuMkgxNVYxMy44SDE0LjR6TTE1LDEzLjJIMTUuNlYxMy44SDE1ek0xNS42LDEzLjJIMTYuMlYxMy44SDE1LjZ6TTE3LjQsMTMuMkgxOFYxMy44SDE3LjR6TTE4LDEzLjJIMTguNlYxMy44SDE4ek02LDEzLjhINi42VjE0LjRINnpNMTAuMiwxMy44SDEwLjhWMTQuNEgxMC4yek0xMC44LDEzLjhIMTEuNFYxNC40SDEwLjh6TTEyLjYsMTMuOEgxMy4yVjE0LjRIMTIuNnpNMTMuMiwxMy44SDEzLjhWMTQuNEgxMy4yek0xNS42LDEzLjhIMTYuMlYxNC40SDE1LjZ6TTEuMiwxNC40SDEuOFYxNUgxLjJ6TTEuOCwxNC40SDIuNFYxNUgxLjh6TTIuNCwxNC40SDNWMTVIMi40ek0zLDE0LjRIMy42VjE1SDN6TTMuNiwxNC40SDQuMlYxNUgzLjZ6TTQuMiwxNC40SDQuOFYxNUg0LjJ6TTQuOCwxNC40SDUuNFYxNUg0Ljh6TTYsMTQuNEg2LjZWMTVINnpNNy44LDE0LjRIOC40VjE1SDcuOHpNOC40LDE0LjRIOVYxNUg4LjR6TTkuNiwxNC40SDEwLjJWMTVIOS42ek0xMC44LDE0LjRIMTEuNFYxNUgxMC44ek0xMS40LDE0LjRIMTJWMTVIMTEuNHpNMTIuNiwxNC40SDEzLjJWMTVIMTIuNnpNMTMuMiwxNC40SDEzLjhWMTVIMTMuMnpNMTQuNCwxNC40SDE1VjE1SDE0LjR6TTE1LjYsMTQuNEgxNi4yVjE1SDE1LjZ6TTE3LjQsMTQuNEgxOFYxNUgxNy40ek0xLjIsMTVIMS44VjE1LjZIMS4yek00LjgsMTVINS40VjE1LjZINC44ek02LDE1SDYuNlYxNS42SDZ6TTcuOCwxNUg4LjRWMTUuNkg3Ljh6TTguNCwxNUg5VjE1LjZIOC40ek05LDE1SDkuNlYxNS42SDl6TTkuNiwxNUgxMC4yVjE1LjZIOS42ek0xMC44LDE1SDExLjRWMTUuNkgxMC44ek0xMiwxNUgxMi42VjE1LjZIMTJ6TTEyLjYsMTVIMTMuMlYxNS42SDEyLjZ6TTEzLjIsMTVIMTMuOFYxNS42SDEzLjJ6TTE1LjYsMTVIMTYuMlYxNS42SDE1LjZ6TTEuMiwxNS42SDEuOFYxNi4ySDEuMnpNMi40LDE1LjZIM1YxNi4ySDIuNHpNMywxNS42SDMuNlYxNi4ySDN6TTMuNiwxNS42SDQuMlYxNi4ySDMuNnpNNC44LDE1LjZINS40VjE2LjJINC44ek02LjYsMTUuNkg3LjJWMTYuMkg2LjZ6TTcuMiwxNS42SDcuOFYxNi4ySDcuMnpNMTAuOCwxNS42SDExLjRWMTYuMkgxMC44ek0xMS40LDE1LjZIMTJWMTYuMkgxMS40ek0xMy4yLDE1LjZIMTMuOFYxNi4ySDEzLjJ6TTEzLjgsMTUuNkgxNC40VjE2LjJIMTMuOHpNMTQuNCwxNS42SDE1VjE2LjJIMTQuNHpNMTUsMTUuNkgxNS42VjE2LjJIMTV6TTE1LjYsMTUuNkgxNi4yVjE2LjJIMTUuNnpNMTYuMiwxNS42SDE2LjhWMTYuMkgxNi4yek0xNy40LDE1LjZIMThWMTYuMkgxNy40ek0xLjIsMTYuMkgxLjhWMTYuOEgxLjJ6TTIuNCwxNi4ySDNWMTYuOEgyLjR6TTMsMTYuMkgzLjZWMTYuOEgzek0zLjYsMTYuMkg0LjJWMTYuOEgzLjZ6TTQuOCwxNi4ySDUuNFYxNi44SDQuOHpNNiwxNi4ySDYuNlYxNi44SDZ6TTcuMiwxNi4ySDcuOFYxNi44SDcuMnpNOC40LDE2LjJIOVYxNi44SDguNHpNOSwxNi4ySDkuNlYxNi44SDl6TTEwLjgsMTYuMkgxMS40VjE2LjhIMTAuOHpNMTEuNCwxNi4ySDEyVjE2LjhIMTEuNHpNMTIuNiwxNi4ySDEzLjJWMTYuOEgxMi42ek0xMy4yLDE2LjJIMTMuOFYxNi44SDEzLjJ6TTEzLjgsMTYuMkgxNC40VjE2LjhIMTMuOHpNMTUsMTYuMkgxNS42VjE2LjhIMTV6TTE1LjYsMTYuMkgxNi4yVjE2LjhIMTUuNnpNMTgsMTYuMkgxOC42VjE2LjhIMTh6TTEuMiwxNi44SDEuOFYxNy40SDEuMnpNMi40LDE2LjhIM1YxNy40SDIuNHpNMywxNi44SDMuNlYxNy40SDN6TTMuNiwxNi44SDQuMlYxNy40SDMuNnpNNC44LDE2LjhINS40VjE3LjRINC44ek02LDE2LjhINi42VjE3LjRINnpNNi42LDE2LjhINy4yVjE3LjRINi42ek03LjgsMTYuOEg4LjRWMTcuNEg3Ljh6TTguNCwxNi44SDlWMTcuNEg4LjR6TTksMTYuOEg5LjZWMTcuNEg5ek05LjYsMTYuOEgxMC4yVjE3LjRIOS42ek0xMS40LDE2LjhIMTJWMTcuNEgxMS40ek0xMiwxNi44SDEyLjZWMTcuNEgxMnpNMTIuNiwxNi44SDEzLjJWMTcuNEgxMi42ek0xNC40LDE2LjhIMTVWMTcuNEgxNC40ek0xNSwxNi44SDE1LjZWMTcuNEgxNXpNMTYuMiwxNi44SDE2LjhWMTcuNEgxNi4yek0xNi44LDE2LjhIMTcuNFYxNy40SDE2Ljh6TTE4LDE2LjhIMTguNlYxNy40SDE4ek0xLjIsMTcuNEgxLjhWMThIMS4yek00LjgsMTcuNEg1LjRWMThINC44ek03LjIsMTcuNEg3LjhWMThINy4yek04LjQsMTcuNEg5VjE4SDguNHpNOSwxNy40SDkuNlYxOEg5ek05LjYsMTcuNEgxMC4yVjE4SDkuNnpNMTAuMiwxNy40SDEwLjhWMThIMTAuMnpNMTMuMiwxNy40SDEzLjhWMThIMTMuMnpNMTQuNCwxNy40SDE1VjE4SDE0LjR6TTE1LDE3LjRIMTUuNlYxOEgxNXpNMTUuNiwxNy40SDE2LjJWMThIMTUuNnpNMTcuNCwxNy40SDE4VjE4SDE3LjR6TTEuMiwxOEgxLjhWMTguNkgxLjJ6TTEuOCwxOEgyLjRWMTguNkgxLjh6TTIuNCwxOEgzVjE4LjZIMi40ek0zLDE4SDMuNlYxOC42SDN6TTMuNiwxOEg0LjJWMTguNkgzLjZ6TTQuMiwxOEg0LjhWMTguNkg0LjJ6TTQuOCwxOEg1LjRWMTguNkg0Ljh6TTYsMThINi42VjE4LjZINnpNNy4yLDE4SDcuOFYxOC42SDcuMnpNOC40LDE4SDlWMTguNkg4LjR6TTEwLjgsMThIMTEuNFYxOC42SDEwLjh6TTEyLDE4SDEyLjZWMTguNkgxMnpNMTIuNiwxOEgxMy4yVjE4LjZIMTIuNnpNMTMuMiwxOEgxMy44VjE4LjZIMTMuMnpNMTUsMThIMTUuNlYxOC42SDE1ek0xNi4yLDE4SDE2LjhWMTguNkgxNi4yek0xNy40LDE4SDE4VjE4LjZIMTcuNHoiIGlkPSJxci1wYXRoIiBmaWxsPSIjMDAwMDAwIiBmaWxsLW9wYWNpdHk9IjEiIGZpbGwtcnVsZT0ibm9uemVybyIgc3Ryb2tlPSJub25lIiAvPjwvc3ZnPg=="></div>
		<div class="network"><strong>BEP-20</strong><span>BNB Chain — low fees</span><code>0x2700732a6f050c10c080154ce73cc641c448b704</code><img class="qr" alt="BEP-20 USDT deposit QR code" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0nMS4wJyBlbmNvZGluZz0nVVRGLTgnPz4KPHN2ZyB3aWR0aD0iMTkuOG1tIiBoZWlnaHQ9IjE5LjhtbSIgdmVyc2lvbj0iMS4xIiB2aWV3Qm94PSIwIDAgMTkuOCAxOS44IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xLjIsMS4ySDEuOFYxLjhIMS4yek0xLjgsMS4ySDIuNFYxLjhIMS44ek0yLjQsMS4ySDNWMS44SDIuNHpNMywxLjJIMy42VjEuOEgzek0zLjYsMS4ySDQuMlYxLjhIMy42ek00LjIsMS4ySDQuOFYxLjhINC4yek00LjgsMS4ySDUuNFYxLjhINC44ek03LjgsMS4ySDguNFYxLjhINy44ek04LjQsMS4ySDlWMS44SDguNHpNOS42LDEuMkgxMC4yVjEuOEg5LjZ6TTEyLjYsMS4ySDEzLjJWMS44SDEyLjZ6TTE0LjQsMS4ySDE1VjEuOEgxNC40ek0xNSwxLjJIMTUuNlYxLjhIMTV6TTE1LjYsMS4ySDE2LjJWMS44SDE1LjZ6TTE2LjIsMS4ySDE2LjhWMS44SDE2LjJ6TTE2LjgsMS4ySDE3LjRWMS44SDE2Ljh6TTE3LjQsMS4ySDE4VjEuOEgxNy40ek0xOCwxLjJIMTguNlYxLjhIMTh6TTEuMiwxLjhIMS44VjIuNEgxLjJ6TTQuOCwxLjhINS40VjIuNEg0Ljh6TTcuMiwxLjhINy44VjIuNEg3LjJ6TTguNCwxLjhIOVYyLjRIOC40ek05LjYsMS44SDEwLjJWMi40SDkuNnpNMTAuMiwxLjhIMTAuOFYyLjRIMTAuMnpNMTIsMS44SDEyLjZWMi40SDEyek0xNC40LDEuOEgxNVYyLjRIMTQuNHpNMTgsMS44SDE4LjZWMi40SDE4ek0xLjIsMi40SDEuOFYzSDEuMnpNMi40LDIuNEgzVjNIMi40ek0zLDIuNEgzLjZWM0gzek0zLjYsMi40SDQuMlYzSDMuNnpNNC44LDIuNEg1LjRWM0g0Ljh6TTYsMi40SDYuNlYzSDZ6TTYuNiwyLjRINy4yVjNINi42ek03LjgsMi40SDguNFYzSDcuOHpNOC40LDIuNEg5VjNIOC40ek0xMC4yLDIuNEgxMC44VjNIMTAuMnpNMTAuOCwyLjRIMTEuNFYzSDEwLjh6TTE0LjQsMi40SDE1VjNIMTQuNHpNMTUuNiwyLjRIMTYuMlYzSDE1LjZ6TTE2LjIsMi40SDE2LjhWM0gxNi4yek0xNi44LDIuNEgxNy40VjNIMTYuOHpNMTgsMi40SDE4LjZWM0gxOHpNMS4yLDNIMS44VjMuNkgxLjJ6TTIuNCwzSDNWMy42SDIuNHpNMywzSDMuNlYzLjZIM3pNMy42LDNINC4yVjMuNkgzLjZ6TTQuOCwzSDUuNFYzLjZINC44ek02LDNINi42VjMuNkg2ek04LjQsM0g5VjMuNkg4LjR6TTksM0g5LjZWMy42SDl6TTEwLjIsM0gxMC44VjMuNkgxMC4yek0xMC44LDNIMTEuNFYzLjZIMTAuOHpNMTEuNCwzSDEyVjMuNkgxMS40ek0xMiwzSDEyLjZWMy42SDEyek0xMy4yLDNIMTMuOFYzLjZIMTMuMnpNMTQuNCwzSDE1VjMuNkgxNC40ek0xNS42LDNIMTYuMlYzLjZIMTUuNnpNMTYuMiwzSDE2LjhWMy42SDE2LjJ6TTE2LjgsM0gxNy40VjMuNkgxNi44ek0xOCwzSDE4LjZWMy42SDE4ek0xLjIsMy42SDEuOFY0LjJIMS4yek0yLjQsMy42SDNWNC4ySDIuNHpNMywzLjZIMy42VjQuMkgzek0zLjYsMy42SDQuMlY0LjJIMy42ek00LjgsMy42SDUuNFY0LjJINC44ek02LDMuNkg2LjZWNC4ySDZ6TTcuMiwzLjZINy44VjQuMkg3LjJ6TTksMy42SDkuNlY0LjJIOXpNOS42LDMuNkgxMC4yVjQuMkg5LjZ6TTEyLjYsMy42SDEzLjJWNC4ySDEyLjZ6TTE0LjQsMy42SDE1VjQuMkgxNC40ek0xNS42LDMuNkgxNi4yVjQuMkgxNS42ek0xNi4yLDMuNkgxNi44VjQuMkgxNi4yek0xNi44LDMuNkgxNy40VjQuMkgxNi44ek0xOCwzLjZIMTguNlY0LjJIMTh6TTEuMiw0LjJIMS44VjQuOEgxLjJ6TTQuOCw0LjJINS40VjQuOEg0Ljh6TTYsNC4ySDYuNlY0LjhINnpNMTAuMiw0LjJIMTAuOFY0LjhIMTAuMnpNMTAuOCw0LjJIMTEuNFY0LjhIMTAuOHpNMTQuNCw0LjJIMTVWNC44SDE0LjR6TTE4LDQuMkgxOC42VjQuOEgxOHpNMS4yLDQuOEgxLjhWNS40SDEuMnpNMS44LDQuOEgyLjRWNS40SDEuOHpNMi40LDQuOEgzVjUuNEgyLjR6TTMsNC44SDMuNlY1LjRIM3pNMy42LDQuOEg0LjJWNS40SDMuNnpNNC4yLDQuOEg0LjhWNS40SDQuMnpNNC44LDQuOEg1LjRWNS40SDQuOHpNNiw0LjhINi42VjUuNEg2ek03LjIsNC44SDcuOFY1LjRINy4yek04LjQsNC44SDlWNS40SDguNHpNOS42LDQuOEgxMC4yVjUuNEg5LjZ6TTEwLjgsNC44SDExLjRWNS40SDEwLjh6TTEyLDQuOEgxMi42VjUuNEgxMnpNMTMuMiw0LjhIMTMuOFY1LjRIMTMuMnpNMTQuNCw0LjhIMTVWNS40SDE0LjR6TTE1LDQuOEgxNS42VjUuNEgxNXpNMTUuNiw0LjhIMTYuMlY1LjRIMTUuNnpNMTYuMiw0LjhIMTYuOFY1LjRIMTYuMnpNMTYuOCw0LjhIMTcuNFY1LjRIMTYuOHpNMTcuNCw0LjhIMThWNS40SDE3LjR6TTE4LDQuOEgxOC42VjUuNEgxOHpNNiw1LjRINi42VjZINnpNNi42LDUuNEg3LjJWNkg2LjZ6TTcuMiw1LjRINy44VjZINy4yek04LjQsNS40SDlWNkg4LjR6TTEuMiw2SDEuOFY2LjZIMS4yek0yLjQsNkgzVjYuNkgyLjR6TTMsNkgzLjZWNi42SDN6TTMuNiw2SDQuMlY2LjZIMy42ek00LjIsNkg0LjhWNi42SDQuMnpNNC44LDZINS40VjYuNkg0Ljh6TTguNCw2SDlWNi42SDguNHpNOSw2SDkuNlY2LjZIOXpNOS42LDZIMTAuMlY2LjZIOS42ek0xMC4yLDZIMTAuOFY2LjZIMTAuMnpNMTEuNCw2SDEyVjYuNkgxMS40ek0xMiw2SDEyLjZWNi42SDEyek0xMi42LDZIMTMuMlY2LjZIMTIuNnpNMTMuMiw2SDEzLjhWNi42SDEzLjJ6TTE0LjQsNkgxNVY2LjZIMTQuNHpNMTUsNkgxNS42VjYuNkgxNXpNMTUuNiw2SDE2LjJWNi42SDE1LjZ6TTE2LjIsNkgxNi44VjYuNkgxNi4yek0xNi44LDZIMTcuNFY2LjZIMTYuOHpNMS4yLDYuNkgxLjhWNy4ySDEuMnpNMyw2LjZIMy42VjcuMkgzek0zLjYsNi42SDQuMlY3LjJIMy42ek00LjIsNi42SDQuOFY3LjJINC4yek01LjQsNi42SDZWNy4ySDUuNHpNNiw2LjZINi42VjcuMkg2ek03LjIsNi42SDcuOFY3LjJINy4yek03LjgsNi42SDguNFY3LjJINy44ek04LjQsNi42SDlWNy4ySDguNHpNMTAuOCw2LjZIMTEuNFY3LjJIMTAuOHpNMTIuNiw2LjZIMTMuMlY3LjJIMTIuNnpNMTQuNCw2LjZIMTVWNy4ySDE0LjR6TTE1LjYsNi42SDE2LjJWNy4ySDE1LjZ6TTE2LjIsNi42SDE2LjhWNy4ySDE2LjJ6TTE4LDYuNkgxOC42VjcuMkgxOHpNMS4yLDcuMkgxLjhWNy44SDEuMnpNMi40LDcuMkgzVjcuOEgyLjR6TTMuNiw3LjJINC4yVjcuOEgzLjZ6TTQuOCw3LjJINS40VjcuOEg0Ljh6TTUuNCw3LjJINlY3LjhINS40ek02LDcuMkg2LjZWNy44SDZ6TTYuNiw3LjJINy4yVjcuOEg2LjZ6TTcuMiw3LjJINy44VjcuOEg3LjJ6TTcuOCw3LjJIOC40VjcuOEg3Ljh6TTksNy4ySDkuNlY3LjhIOXpNMTAuMiw3LjJIMTAuOFY3LjhIMTAuMnpNMTAuOCw3LjJIMTEuNFY3LjhIMTAuOHpNMTMuOCw3LjJIMTQuNFY3LjhIMTMuOHpNMTYuMiw3LjJIMTYuOFY3LjhIMTYuMnpNMTYuOCw3LjJIMTcuNFY3LjhIMTYuOHpNMTcuNCw3LjJIMThWNy44SDE3LjR6TTEuOCw3LjhIMi40VjguNEgxLjh6TTMsNy44SDMuNlY4LjRIM3pNNi42LDcuOEg3LjJWOC40SDYuNnpNNy4yLDcuOEg3LjhWOC40SDcuMnpNOC40LDcuOEg5VjguNEg4LjR6TTEwLjIsNy44SDEwLjhWOC40SDEwLjJ6TTEyLDcuOEgxMi42VjguNEgxMnpNMTMuOCw3LjhIMTQuNFY4LjRIMTMuOHpNMTUsNy44SDE1LjZWOC40SDE1ek0xNS42LDcuOEgxNi4yVjguNEgxNS42ek0xNy40LDcuOEgxOFY4LjRIMTcuNHpNMTgsNy44SDE4LjZWOC40SDE4ek0xLjIsOC40SDEuOFY5SDEuMnpNMS44LDguNEgyLjRWOUgxLjh6TTIuNCw4LjRIM1Y5SDIuNHpNMy42LDguNEg0LjJWOUgzLjZ6TTQuMiw4LjRINC44VjlINC4yek00LjgsOC40SDUuNFY5SDQuOHpNNiw4LjRINi42VjlINnpNNi42LDguNEg3LjJWOUg2LjZ6TTcuMiw4LjRINy44VjlINy4yek03LjgsOC40SDguNFY5SDcuOHpNOC40LDguNEg5VjlIOC40ek05LDguNEg5LjZWOUg5ek0xMC4yLDguNEgxMC44VjlIMTAuMnpNMTAuOCw4LjRIMTEuNFY5SDEwLjh6TTExLjQsOC40SDEyVjlIMTEuNHpNMTMuMiw4LjRIMTMuOFY5SDEzLjJ6TTEzLjgsOC40SDE0LjRWOUgxMy44ek0xNi4yLDguNEgxNi44VjlIMTYuMnpNMTYuOCw4LjRIMTcuNFY5SDE2Ljh6TTE3LjQsOC40SDE4VjlIMTcuNHpNMS4yLDlIMS44VjkuNkgxLjJ6TTEuOCw5SDIuNFY5LjZIMS44ek0yLjQsOUgzVjkuNkgyLjR6TTMsOUgzLjZWOS42SDN6TTQuMiw5SDQuOFY5LjZINC4yek01LjQsOUg2VjkuNkg1LjR6TTYsOUg2LjZWOS42SDZ6TTYuNiw5SDcuMlY5LjZINi42ek03LjgsOUg4LjRWOS42SDcuOHpNOC40LDlIOVY5LjZIOC40ek05LjYsOUgxMC4yVjkuNkg5LjZ6TTEyLDlIMTIuNlY5LjZIMTJ6TTEyLjYsOUgxMy4yVjkuNkgxMi42ek0xNC40LDlIMTVWOS42SDE0LjR6TTE1LDlIMTUuNlY5LjZIMTV6TTE1LjYsOUgxNi4yVjkuNkgxNS42ek0xOCw5SDE4LjZWOS42SDE4ek0xLjIsOS42SDEuOFYxMC4ySDEuMnpNMS44LDkuNkgyLjRWMTAuMkgxLjh6TTQuMiw5LjZINC44VjEwLjJINC4yek00LjgsOS42SDUuNFYxMC4ySDQuOHpNNS40LDkuNkg2VjEwLjJINS40ek02LjYsOS42SDcuMlYxMC4ySDYuNnpNNy4yLDkuNkg3LjhWMTAuMkg3LjJ6TTcuOCw5LjZIOC40VjEwLjJINy44ek05LDkuNkg5LjZWMTAuMkg5ek05LjYsOS42SDEwLjJWMTAuMkg5LjZ6TTEwLjIsOS42SDEwLjhWMTAuMkgxMC4yek0xMS40LDkuNkgxMlYxMC4ySDExLjR6TTEyLDkuNkgxMi42VjEwLjJIMTJ6TTEzLjIsOS42SDEzLjhWMTAuMkgxMy4yek0xNy40LDkuNkgxOFYxMC4ySDE3LjR6TTEuMiwxMC4ySDEuOFYxMC44SDEuMnpNNC4yLDEwLjJINC44VjEwLjhINC4yek01LjQsMTAuMkg2VjEwLjhINS40ek02LDEwLjJINi42VjEwLjhINnpNNy4yLDEwLjJINy44VjEwLjhINy4yek04LjQsMTAuMkg5VjEwLjhIOC40ek05LjYsMTAuMkgxMC4yVjEwLjhIOS42ek0xMC4yLDEwLjJIMTAuOFYxMC44SDEwLjJ6TTEwLjgsMTAuMkgxMS40VjEwLjhIMTAuOHpNMTIuNiwxMC4ySDEzLjJWMTAuOEgxMi42ek0xNSwxMC4ySDE1LjZWMTAuOEgxNXpNMTUuNiwxMC4ySDE2LjJWMTAuOEgxNS42ek0xNy40LDEwLjJIMThWMTAuOEgxNy40ek0xLjIsMTAuOEgxLjhWMTEuNEgxLjJ6TTIuNCwxMC44SDNWMTEuNEgyLjR6TTQuOCwxMC44SDUuNFYxMS40SDQuOHpNNS40LDEwLjhINlYxMS40SDUuNHpNNy44LDEwLjhIOC40VjExLjRINy44ek04LjQsMTAuOEg5VjExLjRIOC40ek05LDEwLjhIOS42VjExLjRIOXpNMTAuMiwxMC44SDEwLjhWMTEuNEgxMC4yek0xMC44LDEwLjhIMTEuNFYxMS40SDEwLjh6TTExLjQsMTAuOEgxMlYxMS40SDExLjR6TTEzLjgsMTAuOEgxNC40VjExLjRIMTMuOHpNMTUsMTAuOEgxNS42VjExLjRIMTV6TTE2LjIsMTAuOEgxNi44VjExLjRIMTYuMnpNMTYuOCwxMC44SDE3LjRWMTEuNEgxNi44ek0xNy40LDEwLjhIMThWMTEuNEgxNy40ek0xOCwxMC44SDE4LjZWMTEuNEgxOHpNMS4yLDExLjRIMS44VjEySDEuMnpNNiwxMS40SDYuNlYxMkg2ek03LjIsMTEuNEg3LjhWMTJINy4yek03LjgsMTEuNEg4LjRWMTJINy44ek04LjQsMTEuNEg5VjEySDguNHpNOS42LDExLjRIMTAuMlYxMkg5LjZ6TTEyLDExLjRIMTIuNlYxMkgxMnpNMTIuNiwxMS40SDEzLjJWMTJIMTIuNnpNMTMuMiwxMS40SDEzLjhWMTJIMTMuMnpNMTQuNCwxMS40SDE1VjEySDE0LjR6TTE1LjYsMTEuNEgxNi4yVjEySDE1LjZ6TTE4LDExLjRIMTguNlYxMkgxOHpNMS4yLDEySDEuOFYxMi42SDEuMnpNMywxMkgzLjZWMTIuNkgzek0zLjYsMTJINC4yVjEyLjZIMy42ek00LjIsMTJINC44VjEyLjZINC4yek00LjgsMTJINS40VjEyLjZINC44ek02LjYsMTJINy4yVjEyLjZINi42ek03LjgsMTJIOC40VjEyLjZINy44ek0xMC4yLDEySDEwLjhWMTIuNkgxMC4yek0xMy44LDEySDE0LjRWMTIuNkgxMy44ek0xNSwxMkgxNS42VjEyLjZIMTV6TTE1LjYsMTJIMTYuMlYxMi42SDE1LjZ6TTEuMiwxMi42SDEuOFYxMy4ySDEuMnpNMi40LDEyLjZIM1YxMy4ySDIuNHpNNC4yLDEyLjZINC44VjEzLjJINC4yek02LjYsMTIuNkg3LjJWMTMuMkg2LjZ6TTcuMiwxMi42SDcuOFYxMy4ySDcuMnpNMTAuOCwxMi42SDExLjRWMTMuMkgxMC44ek0xMy44LDEyLjZIMTQuNFYxMy4ySDEzLjh6TTE1LjYsMTIuNkgxNi4yVjEzLjJIMTUuNnpNMTcuNCwxMi42SDE4VjEzLjJIMTcuNHpNMS4yLDEzLjJIMS44VjEzLjhIMS4yek0zLjYsMTMuMkg0LjJWMTMuOEgzLjZ6TTQuOCwxMy4ySDUuNFYxMy44SDQuOHpNNS40LDEzLjJINlYxMy44SDUuNHpNNi42LDEzLjJINy4yVjEzLjhINi42ek04LjQsMTMuMkg5VjEzLjhIOC40ek05LDEzLjJIOS42VjEzLjhIOXpNMTAuMiwxMy4ySDEwLjhWMTMuOEgxMC4yek0xMC44LDEzLjJIMTEuNFYxMy44SDEwLjh6TTExLjQsMTMuMkgxMlYxMy44SDExLjR6TTEyLDEzLjJIMTIuNlYxMy44SDEyek0xMy4yLDEzLjJIMTMuOFYxMy44SDEzLjJ6TTEzLjgsMTMuMkgxNC40VjEzLjhIMTMuOHpNMTQuNCwxMy4ySDE1VjEzLjhIMTQuNHpNMTUsMTMuMkgxNS42VjEzLjhIMTV6TTE1LjYsMTMuMkgxNi4yVjEzLjhIMTUuNnpNMTYuMiwxMy4ySDE2LjhWMTMuOEgxNi4yek0xNi44LDEzLjJIMTcuNFYxMy44SDE2Ljh6TTE3LjQsMTMuMkgxOFYxMy44SDE3LjR6TTYsMTMuOEg2LjZWMTQuNEg2ek03LjIsMTMuOEg3LjhWMTQuNEg3LjJ6TTguNCwxMy44SDlWMTQuNEg4LjR6TTkuNiwxMy44SDEwLjJWMTQuNEg5LjZ6TTEyLjYsMTMuOEgxMy4yVjE0LjRIMTIuNnpNMTMuMiwxMy44SDEzLjhWMTQuNEgxMy4yek0xNS42LDEzLjhIMTYuMlYxNC40SDE1LjZ6TTE2LjIsMTMuOEgxNi44VjE0LjRIMTYuMnpNMTgsMTMuOEgxOC42VjE0LjRIMTh6TTEuMiwxNC40SDEuOFYxNUgxLjJ6TTEuOCwxNC40SDIuNFYxNUgxLjh6TTIuNCwxNC40SDNWMTVIMi40ek0zLDE0LjRIMy42VjE1SDN6TTMuNiwxNC40SDQuMlYxNUgzLjZ6TTQuMiwxNC40SDQuOFYxNUg0LjJ6TTQuOCwxNC40SDUuNFYxNUg0Ljh6TTYuNiwxNC40SDcuMlYxNUg2LjZ6TTkuNiwxNC40SDEwLjJWMTVIOS42ek0xMC4yLDE0LjRIMTAuOFYxNUgxMC4yek0xMC44LDE0LjRIMTEuNFYxNUgxMC44ek0xMS40LDE0LjRIMTJWMTVIMTEuNHpNMTIuNiwxNC40SDEzLjJWMTVIMTIuNnpNMTMuMiwxNC40SDEzLjhWMTVIMTMuMnpNMTQuNCwxNC40SDE1VjE1SDE0LjR6TTE1LjYsMTQuNEgxNi4yVjE1SDE1LjZ6TTE2LjIsMTQuNEgxNi44VjE1SDE2LjJ6TTE2LjgsMTQuNEgxNy40VjE1SDE2Ljh6TTE3LjQsMTQuNEgxOFYxNUgxNy40ek0xLjIsMTVIMS44VjE1LjZIMS4yek00LjgsMTVINS40VjE1LjZINC44ek02LDE1SDYuNlYxNS42SDZ6TTYuNiwxNUg3LjJWMTUuNkg2LjZ6TTcuMiwxNUg3LjhWMTUuNkg3LjJ6TTguNCwxNUg5VjE1LjZIOC40ek0xMy4yLDE1SDEzLjhWMTUuNkgxMy4yek0xNS42LDE1SDE2LjJWMTUuNkgxNS42ek0xNy40LDE1SDE4VjE1LjZIMTcuNHpNMTgsMTVIMTguNlYxNS42SDE4ek0xLjIsMTUuNkgxLjhWMTYuMkgxLjJ6TTIuNCwxNS42SDNWMTYuMkgyLjR6TTMsMTUuNkgzLjZWMTYuMkgzek0zLjYsMTUuNkg0LjJWMTYuMkgzLjZ6TTQuOCwxNS42SDUuNFYxNi4ySDQuOHpNNiwxNS42SDYuNlYxNi4ySDZ6TTcuOCwxNS42SDguNFYxNi4ySDcuOHpNOC40LDE1LjZIOVYxNi4ySDguNHpNMTAuMiwxNS42SDEwLjhWMTYuMkgxMC4yek0xMS40LDE1LjZIMTJWMTYuMkgxMS40ek0xMiwxNS42SDEyLjZWMTYuMkgxMnpNMTMuMiwxNS42SDEzLjhWMTYuMkgxMy4yek0xMy44LDE1LjZIMTQuNFYxNi4ySDEzLjh6TTE0LjQsMTUuNkgxNVYxNi4ySDE0LjR6TTE1LDE1LjZIMTUuNlYxNi4ySDE1ek0xNS42LDE1LjZIMTYuMlYxNi4ySDE1LjZ6TTE2LjIsMTUuNkgxNi44VjE2LjJIMTYuMnpNMTYuOCwxNS42SDE3LjRWMTYuMkgxNi44ek0xNy40LDE1LjZIMThWMTYuMkgxNy40ek0xOCwxNS42SDE4LjZWMTYuMkgxOHpNMS4yLDE2LjJIMS44VjE2LjhIMS4yek0yLjQsMTYuMkgzVjE2LjhIMi40ek0zLDE2LjJIMy42VjE2LjhIM3pNMy42LDE2LjJINC4yVjE2LjhIMy42ek00LjgsMTYuMkg1LjRWMTYuOEg0Ljh6TTYsMTYuMkg2LjZWMTYuOEg2ek02LjYsMTYuMkg3LjJWMTYuOEg2LjZ6TTcuOCwxNi4ySDguNFYxNi44SDcuOHpNOC40LDE2LjJIOVYxNi44SDguNHpNMTAuOCwxNi4ySDExLjRWMTYuOEgxMC44ek0xMi42LDE2LjJIMTMuMlYxNi44SDEyLjZ6TTE3LjQsMTYuMkgxOFYxNi44SDE3LjR6TTE4LDE2LjJIMTguNlYxNi44SDE4ek0xLjIsMTYuOEgxLjhWMTcuNEgxLjJ6TTIuNCwxNi44SDNWMTcuNEgyLjR6TTMsMTYuOEgzLjZWMTcuNEgzek0zLjYsMTYuOEg0LjJWMTcuNEgzLjZ6TTQuOCwxNi44SDUuNFYxNy40SDQuOHpNNiwxNi44SDYuNlYxNy40SDZ6TTcuMiwxNi44SDcuOFYxNy40SDcuMnpNNy44LDE2LjhIOC40VjE3LjRINy44ek05LDE2LjhIOS42VjE3LjRIOXpNMTAuMiwxNi44SDEwLjhWMTcuNEgxMC4yek0xMC44LDE2LjhIMTEuNFYxNy40SDEwLjh6TTExLjQsMTYuOEgxMlYxNy40SDExLjR6TTEyLDE2LjhIMTIuNlYxNy40SDEyek0xMy44LDE2LjhIMTQuNFYxNy40SDEzLjh6TTE0LjQsMTYuOEgxNVYxNy40SDE0LjR6TTE1LDE2LjhIMTUuNlYxNy40SDE1ek0xNS42LDE2LjhIMTYuMlYxNy40SDE1LjZ6TTE2LjIsMTYuOEgxNi44VjE3LjRIMTYuMnpNMTYuOCwxNi44SDE3LjRWMTcuNEgxNi44ek0xNy40LDE2LjhIMThWMTcuNEgxNy40ek0xLjIsMTcuNEgxLjhWMThIMS4yek00LjgsMTcuNEg1LjRWMThINC44ek03LjIsMTcuNEg3LjhWMThINy4yek05LjYsMTcuNEgxMC4yVjE4SDkuNnpNMTIuNiwxNy40SDEzLjJWMThIMTIuNnpNMTMuMiwxNy40SDEzLjhWMThIMTMuMnpNMTMuOCwxNy40SDE0LjRWMThIMTMuOHpNMTcuNCwxNy40SDE4VjE4SDE3LjR6TTEuMiwxOEgxLjhWMTguNkgxLjJ6TTEuOCwxOEgyLjRWMTguNkgxLjh6TTIuNCwxOEgzVjE4LjZIMi40ek0zLDE4SDMuNlYxOC42SDN6TTMuNiwxOEg0LjJWMTguNkgzLjZ6TTQuMiwxOEg0LjhWMTguNkg0LjJ6TTQuOCwxOEg1LjRWMTguNkg0Ljh6TTYsMThINi42VjE4LjZINnpNNi42LDE4SDcuMlYxOC42SDYuNnpNNy4yLDE4SDcuOFYxOC42SDcuMnpNNy44LDE4SDguNFYxOC42SDcuOHpNOSwxOEg5LjZWMTguNkg5ek0xMC4yLDE4SDEwLjhWMTguNkgxMC4yek0xMS40LDE4SDEyVjE4LjZIMTEuNHpNMTQuNCwxOEgxNVYxOC42SDE0LjR6TTE1LjYsMThIMTYuMlYxOC42SDE1LjZ6TTE2LjIsMThIMTYuOFYxOC42SDE2LjJ6TTE2LjgsMThIMTcuNFYxOC42SDE2Ljh6IiBpZD0icXItcGF0aCIgZmlsbD0iIzAwMDAwMCIgZmlsbC1vcGFjaXR5PSIxIiBmaWxsLXJ1bGU9Im5vbnplcm8iIHN0cm9rZT0ibm9uZSIgLz48L3N2Zz4="></div>
		<div class="network"><strong>ERC-20</strong><span>Ethereum — higher fees (several dollars)</span><code>0x2700732a6f050c10c080154ce73cc641c448b704</code></div>
		</div><p class="warn"><strong>Warning:</strong> send only USDT, on the network shown for that address — funds sent on the wrong network cannot be recovered. 30-day money-back guarantee: crypto refunds are paid in USDT to the sender's address or as store credit.</p>`
		: "";
	const faq = FAQ.map(
		([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`,
	).join("");

	const stepperIndex = method ? 2 : 1;
	const jsonLdBlocks = checkoutJsonLd(`Checkout ${METHOD_TITLES[method]}`, `https://schema.org/${method === "paypal" ? "PayPal" : method === "crypto" ? "CryptoCurrency" : method === "bank" ? "WireTransfer" : "PaymentCard"}`, `Pay via ${METHOD_TITLES[method]}`);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Checkout · ${METHOD_TITLES[method]} · RealWorldCerts</title>
<meta name="description" content="Complete your RealWorldCerts purchase with ${METHOD_TITLES[method]}. Secure, verified delivery by email.">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{--bg:#0b0c10;--panel:#0e1118;--panel2:#111827;--border:#1e2532;--text:#eaeef2;--muted:#9aa4b2;--accent:#3b82f6;--accent2:#22d3ee;--green:#34d399}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Ubuntu,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
a{color:var(--accent2);text-decoration:none}
a:hover{text-decoration:underline}
header{position:sticky;top:0;z-index:10;background:rgba(11,12,16,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.header-in{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:700;font-size:18px;color:#fff;letter-spacing:.2px}
.brand span{color:var(--accent2)}
.back{color:var(--muted);font-size:14px}
main{max-width:1040px;margin:0 auto;padding:24px 20px 60px}
.stepper{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0 22px}
.stepper .step{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 6px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--muted);font-size:12px;text-align:center}
.stepper .step .step-num{width:28px;height:28px;border-radius:999px;background:#151924;border:1px solid #2a3344;color:var(--muted);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.stepper .step.active{border-color:#2a3e58;background:#16263a;color:var(--text)}
.stepper .step.active .step-num{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:var(--accent2);color:#04121a}
.stepper .step.done{color:var(--green)}
.stepper .step.done .step-num{background:#0d1f17;border-color:#1e5c43;color:var(--green)}
.steps-breadcrumb{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px;font-size:13px}
.step-breadcrumb{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid var(--border);border-radius:999px;background:var(--panel);color:var(--muted)}
.step-breadcrumb b{color:var(--text)}
.step-breadcrumb.done{color:var(--green)}
.step-breadcrumb.done b{color:var(--green)}
.step-breadcrumb.cur{border-color:#2a3e58;background:#16263a;color:var(--text)}
.arrow{color:#374151}
.grid{display:grid;grid-template-columns:1.1fr 1fr;gap:24px;align-items:start}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:20px}
.card h2{margin:0 0 16px;font-size:19px}
.card h2 .badge{float:right;font-size:12px;font-weight:600;color:var(--muted);border:1px solid var(--border);padding:3px 10px;border-radius:999px;background:var(--panel2)}
.course{display:flex;gap:14px}
.course img{width:168px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--border)}
.course .t h3{margin:0 0 4px;font-size:15px;line-height:1.3}
.course .t p{margin:0;color:var(--muted);font-size:13px}
ul.what{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:8px}
ul.what li{display:flex;gap:8px;font-size:14px;color:#cdd6e1}
ul.what li::before{content:"✓";color:var(--green);font-weight:700}
.price{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);margin-top:16px;padding-top:14px;font-size:14px;color:var(--muted)}
.price .amt{font-size:22px;font-weight:700;color:#fff}
.steps-pay{list-style:none;margin:0;padding:0;display:grid;gap:16px}
.steps-pay li{display:flex;gap:12px}
.steps-pay .step-num{flex:0 0 30px;height:30px;border-radius:999px;background:#16263a;border:1px solid #2a3e58;color:var(--accent2);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.steps-pay h4{margin:0 0 2px;font-size:15px}
.steps-pay p{margin:0;color:var(--muted);font-size:14px}
.dest{margin-top:18px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px}
.dest label{font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);display:block;margin-bottom:6px}
.dest .val{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;color:#fff;word-break:break-all}
.networks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
.network{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px}
.network strong{display:block;font-size:13px}
.network span{font-size:12px;color:var(--muted)}
.network.rec{border-color:#1e5c43;background:#0d1f17}
.network.rec strong{color:var(--green)}
.network.off{border-color:#7a3b3b;background:#1d1212}
.network.off strong{color:#f3c1c1}
.warn{border:1px solid #7a3b3b;background:#1d1212;color:#f3c1c1;border-radius:10px;padding:10px 12px;font-size:13px}
.ref{margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ref .id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;background:#0a0d13;border:1px dashed #2a3344;padding:8px 12px;border-radius:8px;color:var(--accent2)}
button{cursor:pointer;font:inherit;border-radius:8px;border:1px solid #2a3e58;background:#16263a;color:#eaf1ff;padding:12px 16px}
button:hover{background:#1c2f4a}
.after{background:linear-gradient(180deg,#10202f 0%,var(--panel) 60%);border:1px solid #1e3a52}
.after ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:14px 0 0;padding:0;list-style:none}
.after ul li{display:flex;gap:8px;font-size:14px;color:#cdd6e1}
.after ul li::before{content:"✓";color:var(--accent2);font-weight:700}
.cta-row{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
.cta-row a{display:inline-flex;align-items:center;justify-content:center;padding:14px 18px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#04121a;font-weight:700;font-size:14px;min-height:56px;min-width:44px}
.cta-row a.alt{background:transparent;border:1px solid #2a3e58;color:var(--accent2)}
.cta-row a:hover{text-decoration:none;filter:brightness(1.08)}
details{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin:8px 0}
summary{cursor:pointer;font-weight:600;color:#e2e8f0;min-height:44px;display:flex;align-items:center}
details p{margin:10px 0 2px;color:var(--muted);font-size:14px;line-height:1.6}
.trust{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.trust span{font-size:12px;color:var(--muted);border:1px solid var(--border);padding:6px 10px;border-radius:999px;background:var(--panel2)}
footer{border-top:1px solid var(--border);padding:26px 20px;color:var(--muted);font-size:13px}
.foot-in{max-width:1040px;margin:0 auto;display:flex;gap:18px;flex-wrap:wrap}
.msg{display:none;margin-top:12px;border:1px solid var(--green);color:var(--green);background:#0d1a14;padding:10px 12px;border-radius:8px;font-size:13px}
.faq-section{margin-top:26px}
.faq-section h2{font-size:19px;margin:32px 0 6px}
${baseMobileCSS()}
@media(max-width:840px){.grid{grid-template-columns:1fr}.networks{grid-template-columns:repeat(2,1fr)}}
</style>
${jsonLdBlocks}
</head>
<body>
<header><div class="header-in"><a class="brand" href="/">RealWorld<span>Certs</span></a><a class="back" href="/catalog/index.html">← Back to catalog</a></div></header>
<main>
  ${buildStepper(stepperIndex)}
  <div class="steps-breadcrumb">
    <span class="step-breadcrumb done"><b>1</b> Choose course <span class="arrow">→</span></span>
    <span class="step-breadcrumb done"><b>2</b> Start checkout <span class="arrow">→</span></span>
    <span class="step-breadcrumb cur"><b>3</b> Pay with ${METHOD_TITLES[method]} <span class="arrow">→</span></span>
    <span class="step-breadcrumb"><b>4</b> Get access by email</span>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Order summary <span class="badge" id="payBadge">${METHOD_TITLES[method]}</span></h2>
      <div class="course">
        <img id="courseImg" src="/assets/courses/oscp-certification-exam.svg" alt="Course image">
        <div class="t"><h3 id="courseTitle">Your selected course</h3><p id="courseMeta">Practice tests with detailed explanations</p></div>
      </div>
      <ul class="what">
        <li>Full practice-test bank with explanations</li>
        <li>Lifetime access from any device</li>
        <li>Completion certificate (PDF)</li>
        <li>Email support &amp; exam tips</li>
      </ul>
      <div class="price"><span>Course price</span><span class="amt" id="amount">Confirmed via email</span></div>
      <div class="ref"><span style="color:var(--muted);font-size:13px">Order reference:</span><span class="id" id="orderRef">RWC-…………</span><button id="copyRef">Copy</button></div>
      <p class="msg" id="copiedMsg">Order reference copied.</p>
    </section>

    <section class="card">
      <h2>Pay with ${METHOD_TITLES[method]}</h2>
      <ol class="steps-pay">${steps}</ol>
      <div class="dest">
        <label>${d.label}</label>
        <div class="val" id="destVal">${d.value}</div>
        ${d.note || ""}
      </div>
      ${extra}
    </section>
  </div>

  <section class="card after" style="margin-top:24px">
    <h2>After payment</h2>
    <ul>
      <li>Keep your order reference — we use it to match your payment.</li>
      <li>Send the reference to billing@realworldcerts.com if the payment details don't carry a note field.</li>
      <li>We email your access link within 24 hours of confirmation.</li>
      <li>Questions? Email billing@realworldcerts.com anytime.</li>
    </ul>
    <div class="cta-row"><a href="mailto:billing@realworldcerts.com?subject=Order%20inquiry">Email us about this order</a><a class="alt" href="/catalog/index.html">Continue browsing</a></div>
    <div class="trust"><span>✓ Verified order matching</span><span>✓ 30-day money-back guarantee</span><span>✓ No card stored on this site</span></div>
  </section>

  <div class="faq-section">
    <h2>Frequently asked questions</h2>
    ${faq}
  </div>
</main>
<footer><div class="foot-in"><a href="/catalog/index.html">Course Catalog</a><a href="/cybersecurity.html">Cybersecurity</a><a href="/practice.html">Practice Tests</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a><a href="/refund.html">Refund Policy</a><a href="/terms.html">Terms</a></div></footer>
<script>
(function(){
  const q = new URLSearchParams(location.search);
  const course = q.get("course");
  const slug = q.get("slug");
  const amount = q.get("amount");
  const img = document.getElementById("courseImg");
  const titleEl = document.getElementById("courseTitle");
  const metaEl = document.getElementById("courseMeta");
  if (slug) img.src = "/assets/courses/" + encodeURIComponent(slug) + ".svg";
  if (course) {
    titleEl.textContent = course;
    try { fetch("/data/catalog.json").then(r=>r.json()).then(d=>{
      const hit = (Array.isArray(d.items)?d.items:[]).find(i=>i.slug===slug);
      if (hit) { titleEl.textContent = hit.title; if(hit.practiceTestCount) metaEl.textContent = hit.practiceTestCount + " practice questions with detailed explanations"; }
    }).catch(()=>{}); } catch(e){}
  }
  const amt = document.getElementById("amount");
  if (amount) amt.textContent = "$" + amount;${method === "crypto" ? `
  // Crypto exact-amount fingerprint: the watcher (scripts/rwc-crypto-deposit-watch.mjs)
  // recomputes this from the slug to auto-identify the course on deposit match.
  if (!amount && slug) {
    var fp = 0; for (var fi=0; fi<slug.length; fi++) fp = (fp*31 + slug.charCodeAt(fi)) % 10000;
    amt.textContent = (19 + fp/10000).toFixed(4) + " USDT (exact amount — do not round)";
  }` : ""}
  const dnow = new Date();
  const ref = "RWC-" + dnow.getFullYear().toString().slice(-2) + String(dnow.getMonth()+1).padStart(2,"0") + String(dnow.getDate()).padStart(2,"0") + "-" + Math.random().toString(36).slice(2,8).toUpperCase();
  var fpn = 0; for (var fi2=0; fi2<(slug||"").length; fi2++) fpn = (fpn*31 + (slug||"").charCodeAt(fi2)) % 10000;
  var amtNum = amount ? Number(amount) : (19 + fpn/10000);
  if (location.pathname.indexOf("crypto") >= 0 && slug && q.get("email")) {
    try { fetch("https://preview-sandbox--69b1d8d1b8ddf9df46c66114.base44-preview.app/functions/checkoutIntent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: slug, course: course || "", email: q.get("email"), ref: ref, amount: Math.round(amtNum*10000)/10000, network: "BEP20/ERC20", source: "crypto-page" })
    }).catch(function(){}); } catch(e2) {}
  }

  const refEl = document.getElementById("orderRef");
  refEl.textContent = ref;
  document.getElementById("copyRef").addEventListener("click", function(){
    (navigator.clipboard ? navigator.clipboard.writeText(ref) : Promise.reject()).then(function(){
      document.getElementById("copiedMsg").style.display = "block";
      setTimeout(function(){ document.getElementById("copiedMsg").style.display = "none"; }, 2200);
    }).catch(function(){});
  });
})();
</script>
</body>
</html>
`;
}
