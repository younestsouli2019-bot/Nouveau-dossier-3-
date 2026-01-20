import os
from wet6run.checkout import pipeline

def main():
    domain = "www.realworldcerts.com"
    outdir = os.path.join(os.getcwd(), "output")
    r = pipeline(domain, outdir)
    print("generated checkout at", r["path"])

if __name__ == "__main__":
    main()
