import os
import json
from datetime import datetime
import xml.etree.ElementTree as ET

def _load_catalog_items(outdir):
    catalog_path = os.path.join(outdir, "commercial", "catalog.json")
    try:
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        if isinstance(catalog, list):
            return [x for x in catalog if isinstance(x, dict) and x.get("sku") and x.get("title")]
    except Exception:
        return []
    return []

def _write_redirect_page(outdir, filename, target_path):
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Redirecting…</title>
  <link rel="canonical" href="{target_path}">
  <script>
    (function() {{
      var q = window.location.search || '';
      window.location.replace('{target_path}' + q);
    }})();
  </script>
  <noscript><meta http-equiv="refresh" content="0; url={target_path}"></noscript>
</head>
<body></body>
</html>"""
    with open(os.path.join(outdir, filename), "w", encoding="utf-8") as f:
        f.write(html)

def _write_marketing_pages(domain, outdir, now):
    items = _load_catalog_items(outdir)
    featured = sorted(
        [{"sku": x.get("sku"), "title": x.get("title"), "price": x.get("price")} for x in items],
        key=lambda x: (-(x["price"] if isinstance(x.get("price"), (int, float)) else 0), x["title"] or ""),
    )[:12]

    deals_cards = ""
    if featured:
        deals_cards = "".join(
            [
                f'<div class="card"><span class="tag">Deal</span><h3>{x["title"]}</h3><p>Limited-time promo: <strong>SAVE10</strong></p><div class="cta-row"><a class="btn" href="/checkout/?sku={x["sku"]}&code=SAVE10">Get This</a><a class="btn secondary" href="/hubs/index.html">Browse</a></div></div>'
                for x in featured
                if x.get("sku") and x.get("title")
            ]
        )

    deals_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Deals | {domain}</title>
  <meta name="description" content="Limited-time deals and bundles to help you pass IT certifications faster.">
  <link rel="canonical" href="https://{domain}/deals.html">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="icon" href="/assets/favicon.svg">
</head>
<body>
  <header class="site-header hero">
    <div class="brand"><img src="/assets/logo.svg" class="logo-img"/><div class="hero"><h1>Deals</h1><p class="stats">Save on courses and bundles • Updated {now}</p></div></div>
    <div class="nav"><a href="/hubs/index.html">Explore Categories</a><a href="/deals.html">Deals</a><a href="/tests.html">Timed Mocks</a><a href="/checkout/">Checkout</a></div>
  </header>
  <section class="section">
    <h2>Featured Offers</h2>
    <div class="grid">{deals_cards or '<div class="card"><span class="tag">Promo</span><h3>Save 10% Today</h3><p>Use code <strong>SAVE10</strong> at checkout.</p><div class="cta-row"><a class="btn" href="/hubs/index.html">Browse Catalog</a><a class="btn secondary" href="/checkout/">Checkout</a></div></div>'}</div>
  </section>
  <footer class="footer">
    <p>&copy; {now[:4]} {domain}. All rights reserved.</p>
    <p><a href="/sitemap.xml">Sitemap</a> • <a href="/rss.xml">RSS</a></p>
  </footer>
</body>
</html>"""
    with open(os.path.join(outdir, "deals.html"), "w", encoding="utf-8") as f:
        f.write(deals_html)

    tests_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Timed Mocks | {domain}</title>
  <meta name="description" content="Timed certification mocks and practice sets to build exam speed and confidence.">
  <link rel="canonical" href="https://{domain}/tests.html">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="icon" href="/assets/favicon.svg">
</head>
<body>
  <header class="site-header hero">
    <div class="brand"><img src="/assets/logo.svg" class="logo-img"/><div class="hero"><h1>Timed Mocks</h1><p class="stats">Practice under real exam pressure</p></div></div>
    <div class="nav"><a href="/hubs/index.html">Explore Categories</a><a href="/deals.html">Deals</a><a href="/tests.html">Timed Mocks</a><a href="/checkout/">Checkout</a></div>
  </header>
  <section class="section">
    <h2>How It Works</h2>
    <div class="grid">
      <div class="card"><span class="tag">1</span><h3>Pick a Track</h3><p>Choose your certification category and focus area.</p></div>
      <div class="card"><span class="tag">2</span><h3>Run Timed Sets</h3><p>Train speed and accuracy with exam-style questions.</p></div>
      <div class="card"><span class="tag">3</span><h3>Review & Improve</h3><p>Use weak-area signals to plan your next study session.</p></div>
    </div>
    <div class="cta-row"><a class="btn" href="/hubs/index.html">Explore Categories</a><a class="btn secondary" href="/deals.html">View Deals</a></div>
  </section>
  <footer class="footer">
    <p>&copy; {now[:4]} {domain}. All rights reserved.</p>
    <p><a href="/sitemap.xml">Sitemap</a> • <a href="/rss.xml">RSS</a></p>
  </footer>
</body>
</html>"""
    with open(os.path.join(outdir, "tests.html"), "w", encoding="utf-8") as f:
        f.write(tests_html)

    _write_redirect_page(outdir, "checkout.html", "/checkout/")
    _write_redirect_page(outdir, "payments.html", "/checkout/")

def build_index(domain, outdir):
    now = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Load Catalogs/Lists if available, otherwise scan dirs
    # For simplicity, we will scan the output directory structure
    
    articles = []
    a_dir = os.path.join(outdir, "articles")
    if os.path.exists(a_dir):
        for f in os.listdir(a_dir):
            if f.endswith(".html"):
                # Simplistic title extraction from filename or we could parse
                title = f.replace("-", " ").replace(".html", "").title()
                articles.append({"title": title, "url": "/articles/" + f})
    
    courses = []
    c_dir = os.path.join(outdir, "commercial", "courses")
    if os.path.exists(c_dir):
        for f in os.listdir(c_dir):
            if f.endswith(".html"):
                title = f.replace("-", " ").replace(".html", "").title()
                courses.append({"title": title, "url": "/courses/" + f})

    bundles = []
    b_dir = os.path.join(outdir, "commercial", "bundles")
    if os.path.exists(b_dir):
        for f in os.listdir(b_dir):
            if f.endswith(".html"):
                title = f.replace("-", " ").replace(".html", "").title()
                bundles.append({"title": title, "url": "/bundles/" + f})

    # Build HTML
    html = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{domain} - Real World Certifications</title>
    <meta name="description" content="Pass your IT certifications on the first attempt with our guides, courses, and practice sets.">
    <link rel="canonical" href="https://{domain}/">
    <meta property="og:title" content="{domain} - Real World Certifications">
    <meta property="og:description" content="Courses, bundles and study guides to pass first attempt.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://{domain}/">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="{domain} - Real World Certifications">
    <meta name="twitter:description" content="Courses, bundles and study guides to pass first attempt.">
    <link rel="stylesheet" href="/assets/style.css">
    <link rel="icon" href="/assets/favicon.svg">
</head>
<body>
    <header class="site-header hero">
        <div class="brand"><img src="/assets/logo.svg" class="logo-img"/><div class="hero"><h1>{domain}</h1><p>Your Fast Track to IT Certification Success</p></div></div>
        <div class="nav"><a href="/hubs/index.html">Explore Categories</a><a href="/deals.html">Deals</a><a href="/tests.html">Timed Mocks</a><a href="/checkout/">Checkout</a><a href="/rss.xml">RSS</a></div>
    </header>

    <section class="section">
        <h2>Top Certification Courses</h2>
        <div class="grid">
            {''.join([f'<div class="card"><a href="{c["url"]}"><span class="tag">Course</span><h3>{c["title"]}</h3><p>Comprehensive video training and practice exams.</p></a></div>' for c in courses])}
        </div>
    </section>

    <section class="section">
        <h2>Explore Categories</h2>
        <div class="grid">
            {''.join([f'<div class="card"><a href="/hubs/{h}"><span class="tag">Category</span><h3>{t}</h3><p>Courses and guides by category.</p></a></div>' for t,h in [(x.replace('-', ' ').title().replace(' Hub',''), x) for x in (os.listdir(os.path.join(outdir, "hubs")) if os.path.exists(os.path.join(outdir, "hubs")) else []) if x.endswith(".html")]])}
        </div>
    </section>

    <section class="section">
        <h2>Value Bundles</h2>
        <div class="grid">
            {''.join([f'<div class="card"><a href="{b["url"]}"><span class="tag bundle">Bundle</span><h3>{b["title"]}</h3><p>Save 15% with our curated course packs.</p></a></div>' for b in bundles])}
        </div>
    </section>

    <section class="section">
        <h2>Latest Study Guides</h2>
        <div class="grid">
            {''.join([f'<div class="card"><a href="{a["url"]}"><span class="tag">Guide</span><h3>{a["title"]}</h3><p>Free step-by-step study guides and resources.</p></a></div>' for a in articles])}
        </div>
    </section>

    <footer class="footer">
        <p>&copy; {now[:4]} {domain}. All rights reserved.</p>
        <p><a href="/sitemap.xml">Sitemap</a> • <a href="/rss.xml">RSS</a></p>
    </footer>
</body>
</html>"""

    with open(os.path.join(outdir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # Build Robots.txt
    robots = f"""User-agent: *
Allow: /

Sitemap: https://{domain}/sitemap.xml
Sitemap: https://{domain}/site_sitemap.xml
"""
    with open(os.path.join(outdir, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(robots)

    # Build Site-wide Sitemap
    urls = []
    urls.append(("https://" + domain + "/", now))
    urls.append(("https://" + domain + "/deals.html", now))
    urls.append(("https://" + domain + "/tests.html", now))
    urls.append(("https://" + domain + "/checkout.html", now))
    # Articles
    if os.path.exists(a_dir):
        for f in os.listdir(a_dir):
            if f.endswith(".html"):
                urls.append(("https://" + domain + "/articles/" + f, now))
    # Courses
    if os.path.exists(c_dir):
        for f in os.listdir(c_dir):
            if f.endswith(".html"):
                urls.append(("https://" + domain + "/courses/" + f, now))
    # Bundles
    if os.path.exists(b_dir):
        for f in os.listdir(b_dir):
            if f.endswith(".html"):
                urls.append(("https://" + domain + "/bundles/" + f, now))
    # Hubs
    h_dir = os.path.join(outdir, "hubs")
    if os.path.exists(h_dir):
        for f in os.listdir(h_dir):
            if f.endswith(".html"):
                urls.append(("https://" + domain + "/hubs/" + f, now))
    # Checkout
    ch_path = os.path.join(outdir, "checkout", "index.html")
    if os.path.exists(ch_path):
        urls.append(("https://" + domain + "/checkout/", now))
    sm = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"]
    for loc, lm in urls:
        sm.append("<url><loc>" + loc + "</loc><lastmod>" + lm + "</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>")
    sm.append("</urlset>")
    with open(os.path.join(outdir, "site_sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(sm))

    # Build CNAME for GitHub Pages
    with open(os.path.join(outdir, "CNAME"), "w", encoding="utf-8") as f:
        f.write(domain)

    _write_marketing_pages(domain, outdir, now)

    print(f"Generated index.html, robots.txt, and CNAME in {outdir}")

if __name__ == "__main__":
    import sys
    domain = sys.argv[1] if len(sys.argv) > 1 else "www.realworldcerts.com"
    build_index(domain, "output")
