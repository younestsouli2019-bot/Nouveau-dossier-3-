import os
import re
import json
import hashlib
from datetime import datetime
from .providers import pick_providers

def slugify(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or hashlib.sha1(s.encode()).hexdigest()[:8]

def ensure_dir(p):
    if not os.path.exists(p):
        os.makedirs(p)

def seed_topics(domain):
    base = [
        "CompTIA A+ exam study guide",
        "AWS Certified Solutions Architect practice questions",
        "Cisco CCNA networking fundamentals",
        "Azure Administrator certification roadmap",
        "Google Professional Cloud Architect tips",
        "PMP certification fast track",
        "ITIL 4 Foundation key concepts",
        "Cybersecurity CEH hands-on labs",
        "ISC2 CISSP domain breakdown",
        "Certified Kubernetes Administrator crash course"
    ]
    extras = [
        "best exam dumps alternatives",
        "how to pass on first attempt",
        "free practice tests and answers",
        "latest syllabus changes and updates",
        "study plan week by week",
        "exam day checklist"
    ]
    return [t + " for " + domain for t in base + extras]

def multi_model_text(prompt):
    texts = []
    for p in pick_providers():
        r = p.generate(prompt)
        texts.append(r.text.strip())
    joined = "\n\n".join([t for t in texts if t])
    return joined or prompt

def generate_cta(title):
    providers = pick_providers()
    if providers:
        prompt = f"Generate a compelling, action-oriented call-to-action button text (max 5 words) for an article titled: {title}"
        r = providers[0].generate(prompt)
        cta = r.text.strip()
        if cta and len(cta) < 20:
            return cta
    return "Get Started"

import random

def article_template(title, body, domain, related=None, slug=None, cta=None):
    now = datetime.utcnow().strftime("%Y-%m-%d")
    related_html = ""
    if related:
        related_html = "<section><h3>Read Also</h3><ul>" + "".join(['<li><a href="/articles/' + s + '.html">' + t + '</a></li>' for t, s in related]) + "</ul></section>"
    url = "https://" + domain + "/articles/" + (slug or "") + ".html"
    lead_ep = os.environ.get("LEAD_ENDPOINT", "")
    if not cta:
        cta = "Send"
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + title + "</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"description\" content=\"" + title + "\"><link rel=\"canonical\" href=\"" + url + "\"><meta property=\"og:title\" content=\"" + title + "\"><meta property=\"og:description\" content=\"" + title + "\"><meta property=\"og:type\" content=\"article\"><meta property=\"og:url\" content=\"" + url + "\"><meta name=\"twitter:card\" content=\"summary\"><meta name=\"twitter:title\" content=\"" + title + "\"><meta name=\"twitter:description\" content=\"" + title + "\"><link rel=\"stylesheet\" href=\"/assets/style.css\"><script>function submitLead(e){e.preventDefault();var email=document.getElementById('lead-email').value;var ep='" + lead_ep + "';if(!email)return;if(ep){fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,page:window.location.href})}).then(function(){var el=document.getElementById('lead-status');if(el)el.textContent='Check your inbox.';}).catch(function(){var el=document.getElementById('lead-status');if(el)el.textContent='Submitted.';});}else{var el=document.getElementById('lead-status');if(el)el.textContent='Submitted.';}if(window.gtag)gtag('event','generate_lead',{value:1});if(window.fbq)fbq('track','Lead');if(window.ttq)ttq.track('SubmitForm');}</script></head><body><header class=\"site-header hero\"><div class=\"brand\"><div class=\"logo\"></div><div class=\"hero\"><h1>" + title + "</h1><p class=\"stats\">" + now + "</p></div></div></header><article class=\"container\">" + "".join(["<p>" + x + "</p>" for x in body.split("\n\n")]) + "<section class=\"section\"><div class=\"box\"><h3>Get the 7-Day Study Plan</h3><form onsubmit=\"submitLead(event)\"><input id=\"lead-email\" class=\"input\" type=\"email\" required placeholder=\"Your email\"> <div class=\"cta-row\"><button type=\"submit\" class=\"btn\">" + cta + "</button></div></form><p id=\"lead-status\" class=\"stats\"></p></div></section>" + related_html + "<div class=\"footer\"><p>Source: " + domain + "</p></div></article></body></html>"

def markdown_template(title, body, domain, related=None, slug=None):
    now = datetime.utcnow().strftime("%Y-%m-%d")
    related_md = ""
    if related:
        related_md = "\n\n### Read Also\n" + "\n".join(["- [" + t + "](/articles/" + s + ".html)" for t, s in related])
    return "# " + title + "\n\n" + now + "\n\n" + body + related_md + "\n\n" + "Source: " + domain

def schema_article(title, slug, domain):
    url = "https://" + domain + "/articles/" + slug + ".html"
    data = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "author": {"@type": "Organization", "name": domain},
        "datePublished": datetime.utcnow().strftime("%Y-%m-%d"),
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
        "publisher": {"@type": "Organization", "name": domain}
    }
    return json.dumps(data, ensure_ascii=False)

def schema_faq(title, body, domain):
    qa = []
    parts = [x.strip() for x in body.split("\n") if x.strip()]
    for i in range(0, len(parts), 2):
        q = parts[i]
        a = parts[i + 1] if i + 1 < len(parts) else ""
        qa.append({"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}})
    data = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": qa}
    return json.dumps(data, ensure_ascii=False)

def build_sitemap(domain, items):
    base = "https://" + domain + "/articles/"
    now = datetime.utcnow().strftime("%Y-%m-%d")
    out = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"]
    for slug in items:
        out.append("<url><loc>" + base + slug + ".html</loc><lastmod>" + now + "</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>")
    out.append("</urlset>")
    return "\n".join(out)

def build_rss(domain, items):
    base = "https://" + domain + "/articles/"
    now = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    out = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<rss version=\"2.0\"><channel><title>" + domain + "</title><link>https://" + domain + "</link><description>Updates</description>"]
    for title, slug in items:
        out.append("<item><title>" + title + "</title><link>" + base + slug + ".html</link><pubDate>" + now + "</pubDate></item>")
    out.append("</channel></rss>")
    return "\n".join(out)

def social_posts(title, body, url):
    x = title + " " + url + " " + "#certification #IT #study"
    li = title + " " + url
    fb = title + " " + url
    yt = "Shorts script: " + title + "\n" + body[:200]
    tk = "TikTok script: " + title + "\n" + body[:150]
    rd = "Reddit post: " + title + "\n" + body[:400]
    pin = title + " " + url + " #study #certification"
    ig = title + " " + url + " #IT #exam"
    return {"twitter": x, "linkedin": li, "facebook": fb, "youtube": yt, "tiktok": tk, "reddit": rd, "pinterest": pin, "instagram": ig}

def pipeline(domain, outdir, seeds=None, limit=12):
    ensure_dir(outdir)
    a_dir = os.path.join(outdir, "articles")
    s_dir = os.path.join(outdir, "schema")
    p_dir = os.path.join(outdir, "social")
    ensure_dir(a_dir)
    ensure_dir(s_dir)
    ensure_dir(p_dir)
    topics = seeds or seed_topics(domain)
    topics = topics[:limit]
    
    # Pre-calculate slugs and map for linking
    topic_map = []
    for t in topics:
        topic_map.append((t, slugify(t)))

    slugs = []
    rss_items = []
    for t, slug in topic_map:
        slugs.append(slug)
        
        # Pick 3 related topics (excluding self)
        others = [x for x in topic_map if x[1] != slug]
        related = random.sample(others, min(3, len(others))) if others else []

        body = multi_model_text("Write a detailed, practical, step-by-step guide: " + t + ". Include FAQs and resources.")
        cta = generate_cta(t)
        html = article_template(t, body, domain, related, slug, cta)
        md = markdown_template(t, body, domain, related, slug)
        art_path = os.path.join(a_dir, slug + ".html")
        md_path = os.path.join(a_dir, slug + ".md")
        with open(art_path, "w", encoding="utf-8") as f:
            f.write(html)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md)
        a_schema = schema_article(t, slug, domain)
        f_schema = schema_faq(t, body, domain)
        with open(os.path.join(s_dir, slug + "-article.jsonld"), "w", encoding="utf-8") as f:
            f.write(a_schema)
        with open(os.path.join(s_dir, slug + "-faq.jsonld"), "w", encoding="utf-8") as f:
            f.write(f_schema)
        url = "https://" + domain + "/articles/" + slug + ".html"
        posts = social_posts(t, body, url)
        for k, v in posts.items():
            with open(os.path.join(p_dir, slug + "-" + k + ".txt"), "w", encoding="utf-8") as f:
                f.write(v)
        rss_items.append((t, slug))
    sitemap = build_sitemap(domain, slugs)
    with open(os.path.join(outdir, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(sitemap)
    rss = build_rss(domain, rss_items)
    with open(os.path.join(outdir, "rss.xml"), "w", encoding="utf-8") as f:
        f.write(rss)
    return {"count": len(slugs), "outdir": outdir}
