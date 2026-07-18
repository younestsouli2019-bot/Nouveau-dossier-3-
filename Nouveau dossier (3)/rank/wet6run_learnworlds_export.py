import sys
import os
from wet6run.integrations.learnworlds import pipeline

def main():
    domain = "www.realworldcerts.com"
    commercial_root = os.path.join(os.getcwd(), "output", "commercial")
    outdir = os.path.join(os.getcwd(), "output")
    if len(sys.argv) > 1:
        domain = sys.argv[1]
    if len(sys.argv) > 2:
        commercial_root = sys.argv[2]
    if len(sys.argv) > 3:
        outdir = sys.argv[3]
    r = pipeline(domain, commercial_root, outdir)
    print("exported", r["coupons_csv"], r["ads_csv"], r["links_csv"])

if __name__ == "__main__":
    main()
