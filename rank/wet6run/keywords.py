import os
import json
from .generate import ensure_dir, slugify

def keyword_variants(title):
    base = [
        title,
        title + " study guide",
        title + " practice questions",
        title + " exam tips",
        title + " syllabus",
        title + " pass first attempt",
        title + " exam dumps alternatives",
        title + " free practice test"
    ]
    return [x.lower() for x in base]

def pipeline(commercial_root, outdir):
    k_dir = os.path.join(outdir, "keywords")
    ensure_dir(k_dir)
    catalog_path = os.path.join(commercial_root, "catalog.json")
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    csv_path = os.path.join(k_dir, "keywords.csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("slug,keyword\n")
    for course in catalog:
        slug = slugify(course["title"])
        ks = keyword_variants(course["title"])
        with open(os.path.join(k_dir, slug + "-keywords.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(ks))
        with open(csv_path, "a", encoding="utf-8") as f:
            for k in ks:
                f.write(slug + "," + k + "\n")
    return {"keywords_csv": csv_path, "dir": k_dir}
