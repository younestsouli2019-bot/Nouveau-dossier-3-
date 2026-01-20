import os
from wet6run.assets import pipeline

def main():
    outdir = os.path.join(os.getcwd(), "output")
    r = pipeline(outdir)
    print("wrote style at", r["path"])

if __name__ == "__main__":
    main()
