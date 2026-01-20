import sys
import os
from wet6run.commercial import pipeline

def main():
    domain = "www.realworldcerts.com"
    outdir = os.path.join(os.getcwd(), "output", "commercial")
    if len(sys.argv) > 1:
        domain = sys.argv[1]
    if len(sys.argv) > 2:
        outdir = sys.argv[2]
    r = pipeline(domain, outdir)
    print("generated", r["count"], "courses and", r["bundles"], "bundles at", outdir)

if __name__ == "__main__":
    main()
