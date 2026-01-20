import os

def ensure_dir(p):
    if not os.path.exists(p):
        os.makedirs(p)

def build_style():
    return """
:root{--bg:#0b1021;--surface:#111633;--card:#161b3d;--text:#e6e8ff;--muted:#a5aad4;--accent:#7aa2ff;--accent2:#5bd4ff;--success:#38d39f;--warning:#ffcf5b;--danger:#ff6b6b}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:radial-gradient(1000px 500px at 0% 0%,#0b1021 0%,#0e1430 35%,#0b1021 100%);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif}
.container{max-width:1200px;margin:0 auto;padding:24px}
.site-header{position:relative;padding:64px 24px;text-align:center;background:linear-gradient(135deg,rgba(122,162,255,.15),rgba(91,212,255,.12));border-bottom:1px solid rgba(122,162,255,.2)}
.brand{display:flex;align-items:center;justify-content:center;gap:12px}
.brand .logo{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 6px 24px rgba(91,212,255,.25)}
.brand .logo-img{width:40px;height:40px}
.hero h1{margin:8px 0 6px 0;font-size:2.6rem;letter-spacing:.3px}
.hero p{margin:0;color:var(--muted)}
.nav{display:flex;gap:16px;justify-content:center;margin-top:16px}
.nav a{color:var(--text);text-decoration:none;padding:8px 12px;border-radius:6px;background:rgba(17,22,51,.6);border:1px solid rgba(122,162,255,.25)}
.section{padding:32px 24px}
.section h2{margin:0 0 16px 0;font-size:1.6rem;border-bottom:1px solid rgba(122,162,255,.25);padding-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--card);border:1px solid rgba(122,162,255,.2);border-radius:12px;padding:18px;box-shadow:0 10px 20px rgba(0,0,0,.25);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-4px);box-shadow:0 16px 28px rgba(0,0,0,.35)}
.card h3{margin:6px 0 8px 0;color:#eaf0ff}
.card p{margin:0;color:var(--muted)}
.tag{display:inline-block;margin-bottom:8px;padding:4px 10px;border-radius:999px;font-size:.78rem;background:rgba(122,162,255,.18);border:1px solid rgba(122,162,255,.35);color:#eaf0ff}
.tag.bundle{background:rgba(255,207,91,.18);border-color:rgba(255,207,91,.45)}
.btn{display:inline-block;color:#0b1021;background:linear-gradient(135deg,var(--accent),var(--accent2));padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;box-shadow:0 10px 20px rgba(91,212,255,.3);border:none}
.btn.secondary{background:rgba(17,22,51,.8);color:#eaf0ff;border:1px solid rgba(122,162,255,.3)}
.cta-row{display:flex;gap:12px;justify-content:center;margin-top:12px}
.stats{color:var(--muted);font-size:.95rem}
.footer{border-top:1px solid rgba(122,162,255,.25);margin-top:32px;padding:24px;text-align:center;color:var(--muted)}
.input{width:100%;padding:12px;border-radius:10px;border:1px solid rgba(122,162,255,.3);background:rgba(17,22,51,.8);color:#eaf0ff}
.box{background:var(--surface);border:1px solid rgba(122,162,255,.25);border-radius:12px;padding:16px}
"""

def build_logo():
    return """<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aa2ff"/><stop offset="1" stop-color="#5bd4ff"/></linearGradient></defs>
<rect x="0" y="0" width="40" height="40" rx="8" fill="url(#g)"/>
<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI,Arial" font-size="18" font-weight="700" fill="#0b1021">R</text>
</svg>"""

def build_favicon():
    return """<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 40 40">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aa2ff"/><stop offset="1" stop-color="#5bd4ff"/></linearGradient></defs>
<rect x="0" y="0" width="40" height="40" rx="8" fill="url(#g)"/>
<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI,Arial" font-size="16" font-weight="700" fill="#0b1021">R</text>
</svg>"""

def pipeline(outdir):
    assets = os.path.join(outdir, "assets")
    ensure_dir(assets)
    with open(os.path.join(assets, "style.css"), "w", encoding="utf-8") as f:
        f.write(build_style())
    with open(os.path.join(assets, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(build_logo())
    with open(os.path.join(assets, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(build_favicon())
    return {"path": os.path.join(assets, "style.css")}
