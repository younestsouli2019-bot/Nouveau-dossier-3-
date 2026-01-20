import os
from .generate import ensure_dir, slugify

def classify_course(title):
    t = title.lower()
    if "comptia" in t:
        return "CompTIA"
    if "aws" in t:
        return "AWS"
    if "azure" in t:
        return "Azure"
    if "cisco" in t or "ccna" in t:
        return "Cisco"
    if "cissp" in t or "ceh" in t or "security+" in t:
        return "Cybersecurity"
    if "pmp" in t or "scrum" in t or "prince2" in t:
        return "Project Management"
    if "itil" in t:
        return "IT Service Management"
    if "kubernetes" in t or "cka" in t or "ckad" in t:
        return "Kubernetes"
    if "terraform" in t or "devops" in t:
        return "DevOps"
    return "General"

def level_for_item(name):
    n = name.lower()
    if "fundamentals" in n or "az-900" in n or "a+" in n or "associate cloud engineer" in n:
        return "Beginner"
    if "administrator" in n or "associate" in n or "network+" in n or "security+" in n or "ccna" in n or "terraform associate" in n:
        return "Intermediate"
    if "cissp" in n or "devops professional" in n or "professional" in n or "architect" in n or "ceh" in n:
        return "Advanced"
    return "Intermediate"

def category_icon(title):
    m = {
        "CompTIA": "💻",
        "AWS": "☁️",
        "Azure": "🟦",
        "Cisco": "🌐",
        "Cybersecurity": "🔐",
        "Project Management": "📈",
        "IT Service Management": "🛠️",
        "Kubernetes": "⎈",
        "DevOps": "⚙️",
        "General": "📚"
    }
    return m.get(title, "📚")

def html_page(title, items):
    groups = {"Beginner": [], "Intermediate": [], "Advanced": []}
    for name, url, kind in items:
        lvl = level_for_item(name)
        groups[lvl].append((name, url, kind))
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + title + " Certifications</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"description\" content=\"" + title + " Courses and Guides\"><link rel=\"stylesheet\" href=\"/assets/style.css\"><link rel=\"icon\" href=\"/assets/favicon.svg\"></head><body><header class=\"site-header hero\"><div class=\"brand\"><img src=\"/assets/logo.svg\" class=\"logo-img\"/><div class=\"hero\"><h1>" + category_icon(title) + " " + title + " Certifications</h1><p>Courses and study guides to pass on the first attempt.</p></div></div></header>" + "".join(["<section class=\"section\"><h2>" + lvl + " Path</h2><div class=\"grid\">" + "".join(["<div class=\"card\"><a href=\"" + url + "\"><span class=\"tag\">" + kind + "</span><h3>" + name + "</h3><p>Recommended " + lvl.lower() + " track</p></a></div>" for name, url, kind in groups[lvl]]) + "</div></section>" for lvl in ["Beginner","Intermediate","Advanced"]]) + "<div class=\"footer\"><p>&copy; " + title + "</p></div></body></html>"

def pipeline(domain, outdir):
    c_dir = os.path.join(outdir, "commercial", "courses")
    a_dir = os.path.join(outdir, "articles")
    h_dir = os.path.join(outdir, "hubs")
    ensure_dir(h_dir)
    groups = {}
    # Courses
    if os.path.exists(c_dir):
        for f in os.listdir(c_dir):
            if f.endswith(".html"):
                name = f.replace("-", " ").replace(".html", "").title()
                cat = classify_course(name)
                url = "/courses/" + f
                groups.setdefault(cat, []).append((name, url, "Course"))
    # Articles (simple keyword match)
    if os.path.exists(a_dir):
        for f in os.listdir(a_dir):
            if f.endswith(".html"):
                name = f.replace("-", " ").replace(".html", "").title()
                # naive classification
                cat = classify_course(name)
                url = "/articles/" + f
                groups.setdefault(cat, []).append((name, url, "Guide"))
    for cat, items in groups.items():
        slug = slugify(cat + "-hub")
        html = html_page(cat, items)
        with open(os.path.join(h_dir, slug + ".html"), "w", encoding="utf-8") as f:
            f.write(html)
    # write hubs index
    index = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Explore Categories</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body><h1>Explore Categories</h1><ul>" + "".join(["<li><a href=\"/hubs/" + slugify(cat + "-hub") + ".html\">" + cat + "</a></li>" for cat in sorted(groups.keys())]) + "</ul></body></html>"
    with open(os.path.join(h_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(index)
    return {"count": len(groups)}
