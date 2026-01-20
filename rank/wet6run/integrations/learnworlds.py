import os
import csv
import json
from datetime import datetime

def ensure_dir(p):
    if not os.path.exists(p):
        os.makedirs(p)

def load_promos(marketing_dir):
    items = []
    for name in os.listdir(marketing_dir):
        if name.endswith("-promos.json"):
            with open(os.path.join(marketing_dir, name), "r", encoding="utf-8") as f:
                j = json.load(f)
                for x in j:
                    items.append(x)
    return items

def export_coupons_csv(domain, outdir, marketing_dir):
    ensure_dir(outdir)
    promos = load_promos(marketing_dir)
    path = os.path.join(outdir, "coupons.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "percent", "sku", "start", "end"])
        for p in promos:
            w.writerow([p.get("code", ""), p.get("percent", ""), p.get("sku", ""), p.get("start", ""), p.get("end", "")])
    return path

def export_ads_csv(domain, outdir, marketing_dir):
    ensure_dir(outdir)
    rows = []
    for name in os.listdir(marketing_dir):
        if name.endswith("-ads.json"):
            with open(os.path.join(marketing_dir, name), "r", encoding="utf-8") as f:
                j = json.load(f)
                g = j.get("google", {})
                m = j.get("meta", {})
                rows.append([g.get("headline", ""), g.get("description", ""), g.get("final_url", ""), m.get("primary", ""), m.get("link", "")])
    path = os.path.join(outdir, "ads.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["google_headline", "google_description", "google_final_url", "meta_primary_text", "meta_link"])
        for r in rows:
            w.writerow(r)
    return path

def export_link_map(domain, outdir, courses_dir):
    ensure_dir(outdir)
    rows = []
    for name in os.listdir(courses_dir):
        if name.endswith(".html"):
            slug = name[:-5]
            url = "https://" + domain + "/courses/" + slug + ".html"
            rows.append([slug, url, url + "?utm_source=meta&utm_medium=cpc&utm_campaign=" + slug, url + "?utm_source=tiktok&utm_medium=video&utm_campaign=" + slug, url + "?utm_source=youtube&utm_medium=short&utm_campaign=" + slug])
    path = os.path.join(outdir, "links.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["slug", "base_url", "meta_url", "tiktok_url", "youtube_url"])
        for r in rows:
            w.writerow(r)
    return path

def pipeline(domain, commercial_root, outdir):
    marketing_dir = os.path.join(commercial_root, "marketing")
    courses_dir = os.path.join(commercial_root, "courses")
    lw_dir = os.path.join(outdir, "learnworlds")
    ensure_dir(lw_dir)
    c_csv = export_coupons_csv(domain, lw_dir, marketing_dir)
    a_csv = export_ads_csv(domain, lw_dir, marketing_dir)
    l_csv = export_link_map(domain, lw_dir, courses_dir)
    return {"coupons_csv": c_csv, "ads_csv": a_csv, "links_csv": l_csv}
