import os
from wet6run.hubs import pipeline

def main():
    domain = "www.realworldcerts.com"
    outdir = os.path.join(os.getcwd(), "output")
    r = pipeline(domain, outdir)
    print("generated hubs:", r["count"])

if __name__ == "__main__":
    main()
