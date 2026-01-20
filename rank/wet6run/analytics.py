import os

def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_text(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def build_ga4(ga_id):
    return f"""<script async src="https://www.googletagmanager.com/gtag/js?id={ga_id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', '{ga_id}');
</script>"""

def build_meta(pixel_id):
    return f"""<script>
!function(f,b,e,v,n,t,s){{if(f.fbq)return;n=f.fbq=function(){{n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)}};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{pixel_id}');
fbq('track', 'PageView');
</script><noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id={pixel_id}&ev=PageView&noscript=1"/></noscript>"""

def build_tiktok(tt_id):
    return f"""<script>
!function (w, d, t) {{
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=[
  'page','track','identify','instances','debug','on','off','upload'
  ];ttq.setAndDefer=function(t,e){{t[e]=function(){{t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}}};
  for(var i=0;i<ttq.methods.length;i++){{ttq.setAndDefer(ttq,ttq.methods[i])}}
  ttq.instance=function(t){{var e=ttq._i[t]||[];for(var n=0;n<ttq.methods.length;n++){{ttq.setAndDefer(e,ttq.methods[n])}}return e}};
  ttq.load=function(e,n){{
    var i='https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i=ttq._i||{{}};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{{}};ttq._t[e]=+new Date;
    var a=d.createElement('script');a.type='text/javascript';a.async=!0;a.src=i;
    var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(a,s)
  }};
  ttq.load('{tt_id}');
  ttq.page();
}}(window, document, 'ttq');
</script>"""

def inject_into_html(html, snippets):
    head_close = "</head>"
    idx = html.lower().find(head_close)
    if idx == -1:
        return html
    insertion = "\n".join(snippets) + "\n"
    return html[:idx] + insertion + html[idx:]

def pipeline(outdir):
    ga_id = os.environ.get("GA_ID")
    meta_id = os.environ.get("META_PIXEL_ID")
    tt_id = os.environ.get("TIKTOK_PIXEL_ID")
    snippets = []
    if ga_id:
        snippets.append(build_ga4(ga_id))
    if meta_id:
        snippets.append(build_meta(meta_id))
    if tt_id:
        snippets.append(build_tiktok(tt_id))
    if not snippets:
        return {"updated": 0}
    targets = []
    # Articles
    a_dir = os.path.join(outdir, "articles")
    if os.path.exists(a_dir):
        for f in os.listdir(a_dir):
            if f.endswith(".html"):
                targets.append(os.path.join(a_dir, f))
    # Courses
    c_dir = os.path.join(outdir, "commercial", "courses")
    if os.path.exists(c_dir):
        for f in os.listdir(c_dir):
            if f.endswith(".html"):
                targets.append(os.path.join(c_dir, f))
    # Bundles
    b_dir = os.path.join(outdir, "commercial", "bundles")
    if os.path.exists(b_dir):
        for f in os.listdir(b_dir):
            if f.endswith(".html"):
                targets.append(os.path.join(b_dir, f))
    # Index
    idx_path = os.path.join(outdir, "index.html")
    if os.path.exists(idx_path):
        targets.append(idx_path)
    updated = 0
    for t in targets:
        html = read_text(t)
        new_html = inject_into_html(html, snippets)
        if new_html != html:
            write_text(t, new_html)
            updated += 1
    return {"updated": updated}
