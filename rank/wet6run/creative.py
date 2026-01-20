import os
import json
from .generate import ensure_dir, slugify

def image_prompt(course):
    t = course["title"]
    return {
        "style": "clean, certification, tech, bold CTA",
        "concepts": [
            t + " certificate motif",
            "checklist overlay",
            "study desk and laptop",
            "brand color accents"
        ],
        "text_overlays": [
            t,
            "Pass First Attempt",
            "Enroll Now"
        ],
        "dimensions": "1080x1080"
    }

def video_shots(course):
    t = course["title"]
    return [
        "Hook: 'Want to pass " + t + " on first attempt?'",
        "Pain: 'Syllabus is huge? Practice feels random?'",
        "Solution: 'Structured study plan + practice sets'",
        "Proof: 'Thousands of learners improved retention'",
        "CTA: 'Enroll today at realworldcerts.com/courses/'"
    ]

def hashtags():
    return ["#certification", "#it", "#cloud", "#networking", "#security", "#study", "#exam", "#learn"]

def headlines(course):
    t = course["title"]
    return [
        t + " – Pass First Attempt",
        "Master " + t + " Fast",
        t + " Study Plan and Practice",
        t + " Updated Syllabus Prep",
        "Enroll in " + t + " Today"
    ]

def campaign_rows(domain, course):
    slug = slugify(course["title"])
    url = "https://" + domain + "/courses/" + slug + ".html"
    return [
        ["Meta", "Sales", "50", url + "?utm_source=meta&utm_medium=cpc&utm_campaign=" + slug],
        ["Google", "Sales", "50", url + "?utm_source=google&utm_medium=cpc&utm_campaign=" + slug],
        ["TikTok", "Sales", "25", url + "?utm_source=tiktok&utm_medium=video&utm_campaign=" + slug],
        ["YouTube", "Sales", "25", url + "?utm_source=youtube&utm_medium=short&utm_campaign=" + slug]
    ]

def pipeline(domain, commercial_root, outdir):
    c_dir = os.path.join(commercial_root, "courses")
    m_dir = os.path.join(outdir, "marketing_creatives")
    ensure_dir(m_dir)
    catalog_path = os.path.join(commercial_root, "catalog.json")
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    camp_csv = os.path.join(m_dir, "campaigns.csv")
    with open(camp_csv, "w", encoding="utf-8") as f:
        f.write("channel,objective,daily_budget,landing_url\n")
    for course in catalog:
        slug = slugify(course["title"])
        ip = image_prompt(course)
        vs = video_shots(course)
        hs = hashtags()
        hl = headlines(course)
        with open(os.path.join(m_dir, slug + "-image_prompt.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(ip, ensure_ascii=False))
        with open(os.path.join(m_dir, slug + "-video_shots.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(vs))
        with open(os.path.join(m_dir, slug + "-hashtags.txt"), "w", encoding="utf-8") as f:
            f.write(" ".join(hs))
        with open(os.path.join(m_dir, slug + "-headlines.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(hl))
        rows = campaign_rows(domain, course)
        with open(camp_csv, "a", encoding="utf-8") as f:
            for r in rows:
                f.write(",".join(r) + "\n")
    return {"creatives_dir": m_dir, "campaigns_csv": camp_csv}
