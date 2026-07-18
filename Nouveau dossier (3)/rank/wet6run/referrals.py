import os
from .generate import ensure_dir

def pipeline(domain, outdir, partners=None):
    a_dir = os.path.join(outdir, "affiliates")
    ensure_dir(a_dir)
    base = partners or [
        {"partner_id": "YT-RWC", "name": "YouTube Channel"},
        {"partner_id": "TT-RWC", "name": "TikTok Account"},
        {"partner_id": "TW-RWC", "name": "Twitter X"},
        {"partner_id": "LI-RWC", "name": "LinkedIn Page"}
    ]
    csv_path = os.path.join(a_dir, "affiliates.csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("partner_id,name,link_template\n")
        for p in base:
            f.write(p["partner_id"] + "," + p["name"] + "," + "https://" + domain + "/courses/{slug}.html?aff=" + p["partner_id"] + "\n")
    return {"affiliates_csv": csv_path}
