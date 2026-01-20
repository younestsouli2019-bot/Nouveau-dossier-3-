import sys
import os
from wet6run.keywords import pipeline

def main():
    commercial_root = os.path.join(os.getcwd(), "output", "commercial")
    outdir = os.path.join(os.getcwd(), "output")
    if len(sys.argv) > 1:
        commercial_root = sys.argv[1]
    if len(sys.argv) > 2:
        outdir = sys.argv[2]
    r = pipeline(commercial_root, outdir)
    print("generated keywords at", r["keywords_csv"])

if __name__ == "__main__":
    main()
