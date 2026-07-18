import sys
import os
from wet6run.generate import pipeline

def main():
    domain = "www.realworldcerts.com"
    outdir = os.path.join(os.getcwd(), "output")
    if len(sys.argv) > 1:
        domain = sys.argv[1]
    if len(sys.argv) > 2:
        outdir = sys.argv[2]
    r = pipeline(domain, outdir)
    print("generated", r["count"], "items at", r["outdir"])

if __name__ == "__main__":
    main()
