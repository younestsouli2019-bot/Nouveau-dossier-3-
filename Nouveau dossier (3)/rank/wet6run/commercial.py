import os
import json
import re
import random
from datetime import datetime, timedelta
from .generate import ensure_dir, slugify, schema_faq, multi_model_text

def default_catalog(domain):
    return [
        {"title": "CompTIA A+ Complete Course", "sku": "APLUS-001", "price": 129.0, "currency": "USD", "domain": domain},
        {"title": "CompTIA Network+ Course", "sku": "NETPLUS-001", "price": 139.0, "currency": "USD", "domain": domain},
        {"title": "CompTIA Security+ Course", "sku": "SECPLUS-001", "price": 149.0, "currency": "USD", "domain": domain},
        {"title": "AWS Solutions Architect Associate Course", "sku": "AWS-SAA-001", "price": 149.0, "currency": "USD", "domain": domain},
        {"title": "AWS Developer Associate Course", "sku": "AWS-DVA-001", "price": 149.0, "currency": "USD", "domain": domain},
        {"title": "Google Associate Cloud Engineer Course", "sku": "GCP-ACE-001", "price": 149.0, "currency": "USD", "domain": domain},
        {"title": "Azure Administrator AZ-104 Course", "sku": "AZ104-001", "price": 149.0, "currency": "USD", "domain": domain},
        {"title": "Azure Fundamentals AZ-900 Course", "sku": "AZ900-001", "price": 119.0, "currency": "USD", "domain": domain},
        {"title": "Cisco CCNA 200-301 Course", "sku": "CCNA-301-001", "price": 139.0, "currency": "USD", "domain": domain},
        {"title": "Terraform Associate Course", "sku": "TF-ASSOC-001", "price": 139.0, "currency": "USD", "domain": domain},
        {"title": "Certified Kubernetes Administrator Course", "sku": "CKA-001", "price": 169.0, "currency": "USD", "domain": domain},
        {"title": "Certified Kubernetes Application Developer Course", "sku": "CKAD-001", "price": 159.0, "currency": "USD", "domain": domain},
        {"title": "DevOps Professional DOP-C02 Course", "sku": "AWS-DOP-001", "price": 169.0, "currency": "USD", "domain": domain},
        {"title": "ITIL 4 Foundation Course", "sku": "ITIL4F-001", "price": 129.0, "currency": "USD", "domain": domain},
        {"title": "PMP Exam Prep Course", "sku": "PMP-001", "price": 179.0, "currency": "USD", "domain": domain},
        {"title": "Scrum Master Certification Course", "sku": "SCRUM-SM-001", "price": 129.0, "currency": "USD", "domain": domain},
        {"title": "PRINCE2 Foundation Course", "sku": "PRINCE2F-001", "price": 139.0, "currency": "USD", "domain": domain},
        {"title": "CEH v12 Ethical Hacking Course", "sku": "CEH-12-001", "price": 189.0, "currency": "USD", "domain": domain},
        {"title": "CISSP Full Domains Course", "sku": "CISSP-001", "price": 199.0, "currency": "USD", "domain": domain}
    ]

def offer_schema(course, url):
    data = {
        "@context": "https://schema.org",
        "@type": "Course",
        "name": course["title"],
        "provider": {"@type": "Organization", "name": course["domain"]},
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": str(round(random.uniform(4.7, 5.0), 1)),
            "ratingCount": random.randint(450, 2500)
        },
        "hasCourseInstance": {
            "@type": "CourseInstance",
            "courseMode": "online",
            "offers": {
                "@type": "Offer",
                "price": str(course["price"]),
                "priceCurrency": course["currency"],
                "availability": "https://schema.org/InStock",
                "url": url,
                "sku": course["sku"]
            }
        }
    }
    return json.dumps(data, ensure_ascii=False)

def landing_html(course, body, faq_jsonld, offer_jsonld):
    now = datetime.utcnow().strftime("%Y-%m-%d")
    title = course["title"]
    price = course["price"]
    
    # Trust Signals & Urgency
    reviews = str(random.randint(450, 2500))
    rating = str(round(random.uniform(4.7, 5.0), 1))
    students = str(random.randint(1200, 8000))
    lead_endpoint = os.environ.get("LEAD_ENDPOINT", "")
    
    slug = slugify(title)
    page_url = "https://" + course["domain"] + "/courses/" + slug + ".html"
    return f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{title} | Pass First Attempt</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="Master {title} with our comprehensive course. {students}+ students enrolled. Rated {rating}/5.">
    <link rel="canonical" href="{page_url}">
    <meta property="og:title" content="{title} | Pass First Attempt">
    <meta property="og:description" content="Master {title}. Rated {rating}/5 by {reviews}+ learners.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{page_url}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="{title} | Pass First Attempt">
    <meta name="twitter:description" content="Master {title}. Rated {rating}/5 by {reviews}+ learners.">
    <script type="application/ld+json">{offer_jsonld}</script>
    <script type="application/ld+json">{faq_jsonld}</script>
    <link rel="stylesheet" href="/assets/style.css">
    <link rel="icon" href="/assets/favicon.svg">
    <script>
      function trackViewItem() {{
        var sku = '{course["sku"]}';
        var title = '{title}';
        if (window.gtag) {{
          gtag('event', 'view_item', {{items: [{{item_id: sku, item_name: title}}] }});
        }}
        if (window.fbq) {{
          fbq('track', 'ViewContent', {{content_ids: [sku], content_name: title}});
        }}
        if (window.ttq) {{
          ttq.track('ViewContent');
        }}
      }}
      function trackCheckout() {{
        var sku = '{course["sku"]}';
        var title = '{title}';
        if (window.gtag) {{
          gtag('event', 'begin_checkout', {{items: [{{item_id: sku, item_name: title}}] }});
        }}
        if (window.fbq) {{
          fbq('track', 'InitiateCheckout', {{content_ids: [sku], content_name: title}});
        }}
        if (window.ttq) {{
          ttq.track('InitiateCheckout');
        }}
      }}
      function abInit() {{
        var params = new URLSearchParams(window.location.search);
        var cta = params.get('ab_cta');
        var badge = params.get('ab_badge');
        var deadline = params.get('ab_deadline');
        var ctaBtn = document.getElementById('cta-btn');
        if (ctaBtn && cta) ctaBtn.textContent = cta;
        var badgeEl = document.getElementById('badge');
        if (badgeEl && badge) badgeEl.textContent = badge;
        var urg = document.getElementById('urgency');
        if (urg && deadline) urg.textContent = 'Offer ends ' + deadline;
      }}
      function submitLead(e) {{
        e.preventDefault();
        var email = document.getElementById('lead-email').value;
        var sku = '{course["sku"]}';
        var ep = '{lead_endpoint}';
        if (!email) return;
        if (ep) {{
          fetch(ep, {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{ email: email, sku: sku, page: window.location.href }})
          }}).then(function(){{ 
            var el = document.getElementById('lead-status'); 
            if (el) el.textContent = 'Check your inbox for the study plan.'; 
          }}).catch(function(){{ 
            var el = document.getElementById('lead-status'); 
            if (el) el.textContent = 'Submitted.'; 
          }});
        }} else {{
          var el = document.getElementById('lead-status'); 
          if (el) el.textContent = 'Submitted.'; 
        }}
        if (window.gtag) gtag('event', 'generate_lead', {{ value: 1 }});
        if (window.fbq) fbq('track', 'Lead');
        if (window.ttq) ttq.track('SubmitForm');
      }}
      document.addEventListener('DOMContentLoaded', function(){{ trackViewItem(); abInit(); }});
      (function(){{
        try {{
          var sku = '{course["sku"]}';
          fetch('/ab_config.json').then(function(r){{ return r.json(); }}).then(function(cfg){{ 
            var c = cfg[sku] || {{}};
            if (c.cta) document.getElementById('cta-btn').textContent = c.cta;
            if (c.badge) document.getElementById('badge').textContent = c.badge;
            if (c.deadline) document.getElementById('urgency').textContent = 'Offer ends ' + c.deadline;
          }}).catch(function(){{}});
        }} catch(e) {{}}
      }})();
    </script>
    <style>
        body {{ font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 900px; margin: 0 auto; padding: 0; }}
        header {{ background: #f8f9fa; padding: 40px 20px; text-align: center; border-bottom: 1px solid #e9ecef; }}
        h1 {{ margin: 0 0 10px 0; color: #2c3e50; font-size: 2.5rem; }}
        .badge {{ display: inline-block; background: #e2f0d9; color: #2d6a4f; padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9rem; margin-bottom: 15px; }}
        .price-box {{ background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; margin-top: 20px; }}
        .price {{ font-size: 2rem; color: #2c3e50; font-weight: bold; }}
        .old-price {{ text-decoration: line-through; color: #999; font-size: 1.2rem; margin-right: 10px; }}
        .cta-btn {{ display: inline-block; background: #007bff; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 1.2rem; margin-top: 10px; transition: background 0.2s; }}
        .cta-btn:hover {{ background: #0056b3; }}
        .stats {{ margin-top: 15px; color: #666; font-size: 0.9rem; }}
        section {{ padding: 40px 20px; }}
        .guarantee {{ background: #f0f7ff; border: 1px solid #cce5ff; padding: 20px; border-radius: 8px; text-align: center; margin: 40px 0; }}
        footer {{ background: #343a40; color: white; text-align: center; padding: 40px 20px; margin-top: 40px; }}
        ul {{ text-align: left; max-width: 600px; margin: 0 auto; }}
        li {{ margin-bottom: 10px; }}
    </style>
    </head>
<body>
    <header class="site-header hero">
        <div class="brand"><img src="/assets/logo.svg" class="logo-img"/><div class="hero"><h1>{title}</h1><p class="stats">⭐⭐⭐⭐⭐ {rating} ({reviews} ratings) • {students} students enrolled</p></div></div>
        <div id="urgency" class="stats"></div>
        <div class="cta-row"><a id="cta-btn" href="/checkout?sku={course["sku"]}" onclick="trackCheckout()" class="btn">Enroll Now & Pass</a><a href="/hubs/index.html" class="btn secondary">Explore Categories</a></div>
        <div class="stats">Price <strong>${int(price)}</strong> • <span class="muted">Was ${int(price * 1.5)}</span></div>
    </header>

    <section>
        { "".join([f"<p>{x}</p>" for x in body.split("\\n\\n")]) }
    </section>

    <section class="section">
        <h2>What Students Say</h2>
        <div class="grid">
            <div class="card"><span class="tag">Review</span><h3>Clear explanations</h3><p>Concise and practical. Passed first attempt.</p></div>
            <div class="card"><span class="tag">Review</span><h3>Great practice exams</h3><p>Questions matched the real exam style closely.</p></div>
            <div class="card"><span class="tag">Review</span><h3>Structured roadmap</h3><p>The weekly plan kept me on track to finish.</p></div>
        </div>
    </section>

    <section class="section">
        <div class="box">
            <h2>Get the 7-Day First Attempt Study Plan</h2>
            <form onsubmit="submitLead(event)">
                <input id="lead-email" class="input" type="email" required placeholder="Your email">
                <div class="cta-row"><button type="submit" class="btn">Send Me The Plan</button></div>
            </form>
            <p id="lead-status" class="stats"></p>
        </div>
    </section>

    <section style="background: #fafafa;">
        <h2 style="text-align: center;">What's Included</h2>
        <ul>
            <li>✅ <strong>Complete Video Syllabus:</strong> Covers every exam objective in depth.</li>
            <li>✅ <strong>Hands-on Labs:</strong> Real-world scenarios to build practical skills.</li>
            <li>✅ <strong>Practice Exams:</strong> 3 full-length simulations to test your readiness.</li>
            <li>✅ <strong>Study Plan:</strong> Step-by-step roadmap to certification.</li>
            <li>✅ <strong>Instructor Support:</strong> Q&A access for your doubts.</li>
        </ul>
    </section>

    <section class="section"><div class="box"><h3>🛡️ 100% Risk-Free Guarantee</h3><p>Try the course for 7 days. If you're not satisfied, get a full refund.</p></div></section>

    <section>
        <h2 style="text-align: center;">Frequently Asked Questions</h2>
        { "".join([f"<details style='margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px;'><summary style='cursor:pointer; font-weight:bold;'>{item['name']}</summary><p style='margin-top:10px;'>{item['acceptedAnswer']['text']}</p></details>" for item in json.loads(faq_jsonld)["mainEntity"]]) if "mainEntity" in json.loads(faq_jsonld) else "" }
    </section>

    <footer>
        <p>&copy; {now[:4]} {course["domain"]}. All rights reserved.</p>
        <p>Start your career transformation today.</p>
    </footer>
</body>
</html>"""

def email_sequence(course, domain):
    base = []
    base.append(("Lead Day 0: Welcome to " + course["title"], "Thanks for joining. Your study plan starts now. Visit: https://" + domain + "/courses/" + slugify(course["title"]) + ".html"))
    base.append(("Lead Day 2: Free practice set", "Get 20 practice questions today. Visit: https://" + domain + "/courses/" + slugify(course["title"]) + ".html"))
    base.append(("Lead Day 5: Pass faster", "Break down the syllabus and pass on first attempt. Visit: https://" + domain + "/courses/" + slugify(course["title"]) + ".html"))
    base.append(("Abandoned Cart Day 0", "You were close. Resume enrollment: https://" + domain + "/checkout?sku=" + course["sku"]))
    base.append(("Abandoned Cart Day 2", "Here’s a 10% code: SAVE10. Resume: https://" + domain + "/checkout?sku=" + course["sku"]))
    base.append(("Upsell Week 2", "Bundle discount on related courses. See bundles: https://" + domain + "/bundles"))
    return base

def promo_codes(course, count=10, percent=10):
    codes = []
    start = datetime.utcnow()
    end = start + timedelta(days=30)
    for i in range(count):
        code = slugify(course["sku"] + "-" + str(i) + "-" + course["title"])[:10].upper()
        codes.append({"sku": course["sku"], "code": code, "percent": percent, "start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d")})
    return codes

def ads_copy(course, domain):
    url = "https://" + domain + "/courses/" + slugify(course["title"]) + ".html"
    h1 = course["title"] + " – Pass First Attempt"
    p1 = "Full syllabus, practice questions, study plan. Enroll now."
    gads = {"headline": h1, "description": p1, "final_url": url}
    meta = {"primary": course["title"] + " course. Enroll today.", "link": url}
    return {"google": gads, "meta": meta}

def bundles(catalog):
    out = []
    pairs = [("CompTIA A+ Complete Course", "Cisco CCNA 200-301 Course"),
             ("AWS Solutions Architect Associate Course", "Azure Administrator AZ-104 Course"),
             ("CISSP Full Domains Course", "CEH v12 Ethical Hacking Course")]
    for a, b in pairs:
        ca = next((x for x in catalog if x["title"] == a), None)
        cb = next((x for x in catalog if x["title"] == b), None)
        if ca and cb:
            t = a + " + " + b + " Bundle"
            price = round((ca["price"] + cb["price"]) * 0.85, 2)
            out.append({"title": t, "sku": slugify(ca["sku"] + "-" + cb["sku"])[:12].upper(), "price": price, "currency": "USD", "domain": ca["domain"], "courses": [ca["sku"], cb["sku"]]})
    return out

def bundle_html(bundle, domain):
    title = bundle["title"]
    now = datetime.utcnow().strftime("%Y-%m-%d")
    price = bundle["price"]
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + title + "</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"description\" content=\"" + title + "\"><script>function trackCheckout(){ if(window.gtag) gtag('event','begin_checkout'); if(window.fbq) fbq('track','InitiateCheckout'); if(window.ttq) ttq.track('InitiateCheckout'); }</script></head><body><header><h1>" + title + "</h1><p><strong>$" + str(price) + "</strong></p><a href=\"/checkout?sku=" + bundle["sku"] + "\" onclick=\"trackCheckout()\" rel=\"nofollow\">Get Bundle</a></header><section><h2>Included</h2><ul><li>" + "</li><li>".join(bundle["courses"]) + "</li></ul></section><section><h2>Why bundle</h2><p>Save 15% and accelerate your learning.</p></section><footer><p>" + now + "</p></footer></body></html>"

def generate_campaign_pack(course, outdir, overrides=None):
    """Generates direct-response ad copy and email blasts for SALES."""
    c_name = course["title"]
    c_sku = course["sku"]
    
    # 1. Facebook/Instagram Ads CSV
    # Apply agent overrides if provided
    fb_ads = overrides.get("facebook_ads") if overrides and isinstance(overrides.get("facebook_ads"), list) else [
        "Headline,Primary Text,Headline 2,Description,Call to Action,URL",
        f"Pass {c_name} First Try?,Stop failing exams. Get the cheat code. 98% pass rate.,Certified in 30 Days,Join 12,000+ students.,Listen Now,https://www.realworldcerts.com/checkout?sku={c_sku}",
        f"Salary Bump Alert 💸,Average {c_name} salary is $120k. You are one exam away.,Get Hired Faster,Employers are looking for this cert.,Apply Now,https://www.realworldcerts.com/checkout?sku={c_sku}",
        f"Don't Waste $300 on Exam Fees,Our practice tests are harder than the real thing. If you pass ours, you pass theirs.,Guaranteed Pass,Money back guarantee.,Book Now,https://www.realworldcerts.com/checkout?sku={c_sku}"
    ]
    
    # 2. Google Ads CSV (RSA)
    google_ads = overrides.get("google_ads") if overrides and isinstance(overrides.get("google_ads"), list) else [
        "Headline 1,Headline 2,Headline 3,Description 1,Description 2,Final URL",
        f"{c_name} Exam Prep,Pass on First Attempt,98% Pass Rate,Comprehensive video course and practice exams.,Money-back guarantee if you don't pass.,https://www.realworldcerts.com/courses/{slugify(c_name)}.html",
        f"Best {c_name} Course,Certified in 2 Weeks,Salary Increase Guide,Stop wasting time on random videos.,Follow a structured path to certification.,https://www.realworldcerts.com/courses/{slugify(c_name)}.html"
    ]
    
    # 3. Email Broadcast (Hard Sell)
    email_copy = overrides.get("email_blast") if overrides and isinstance(overrides.get("email_blast"), str) else f"""
Subject: Bad news (price increase)
Subject: You are leaving money on the table
Subject: 120k/year opportunity

Hey,

If you are serious about passing the {c_name}, you need to stop watching random YouTube videos.

They are outdated. They are incomplete. And they will cause you to FAIL.

I have built the only system you need.
- Full Syllabus
- 500+ Practice Questions
- Simulation Exams

It's currently available for a discount, but I am raising the price on Sunday.

Click here to secure your pass:
https://www.realworldcerts.com/checkout?sku={c_sku}

Don't come crying to me when you fail the exam because you were "too cheap" to invest in your career.

To your success,
Real World Certs
"""

    # Write files
    pack_dir = os.path.join(outdir, "campaigns", c_sku)
    ensure_dir(pack_dir)
    
    with open(os.path.join(pack_dir, "facebook_ads.csv"), "w", encoding="utf-8") as f:
        f.write("\n".join(fb_ads))
        
    with open(os.path.join(pack_dir, "google_ads.csv"), "w", encoding="utf-8") as f:
        f.write("\n".join(google_ads))
        
    with open(os.path.join(pack_dir, "email_blast.txt"), "w", encoding="utf-8") as f:
        f.write(email_copy)

def write_ab_config(outdir, catalog_path, logs_dir, overrides=None):
    """
    Reads logs to find top performers and updates ab_config.json.
    Currently just a stub that writes a default config if none exists.
    """
    config_path = os.path.join(outdir, "ab_config.json")
    config = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}
    # Apply agent overrides first
    if overrides and isinstance(overrides, dict):
        for sku, ov in overrides.items():
            config[sku] = {**config.get(sku, {}), **ov}
    # Initialize file if missing
    if not os.path.exists(config_path):
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(config, indent=2))
    
    # In a real scenario, we'd read logs_dir/*.jsonl and update conversion rates
    # Persist updates
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(config, indent=2))
    print(f"Updated A/B config at {config_path}")

def pipeline(domain, outdir, catalog=None, recommendations=None):
    ensure_dir(outdir)
    # ... existing directory setup ...
    c_dir = os.path.join(outdir, "courses") # Keep generating pages as "Sales Pages"
    e_dir = os.path.join(outdir, "emails")
    m_dir = os.path.join(outdir, "marketing")
    b_dir = os.path.join(outdir, "bundles")
    camp_dir = os.path.join(outdir, "campaigns") # New Campaign Dir
    ensure_dir(c_dir)
    ensure_dir(e_dir)
    ensure_dir(m_dir)
    ensure_dir(b_dir)
    ensure_dir(camp_dir)
    
    items = catalog or default_catalog(domain)
    for course in items:
        # ... existing generation ...
        slug = slugify(course["title"])
        url = "https://" + domain + "/courses/" + slug + ".html"
        body = multi_model_text("Write a persuasive DIRECT RESPONSE sales letter for: " + course["title"] + ". Focus on PAIN (failing, low salary) and GAIN (jobs, money). Use bullet points.")
        faq = schema_faq(course["title"], body, domain)
        offer = offer_schema(course, url)
        html = landing_html(course, body, faq, offer)
        with open(os.path.join(c_dir, slug + ".html"), "w", encoding="utf-8") as f:
            f.write(html)
            
        # Generate Campaign Pack (New) with agent overrides if any
        overrides = None
        if recommendations and isinstance(recommendations.get("campaigns"), dict):
            overrides = recommendations["campaigns"].get(course["sku"])
        generate_campaign_pack(course, outdir, overrides=overrides)
        
    # ... bundle generation ...
    bnds = bundles(items)
    for b in bnds:
        s = slugify(b["title"])
        html = bundle_html(b, domain)
        with open(os.path.join(b_dir, s + ".html"), "w", encoding="utf-8") as f:
            f.write(html)
            
    with open(os.path.join(outdir, "catalog.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(items, ensure_ascii=False))
        
    return {"count": len(items), "bundles": len(bnds), "campaigns": len(items)}
