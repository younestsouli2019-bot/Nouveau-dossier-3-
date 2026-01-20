import os
from wet6run.deploy import pipeline

def main():
    outdir = os.path.join(os.getcwd(), "output")
    r = pipeline(outdir)
    print("deploy package:", r["zip"], "uploaded:", r["uploaded"])

if __name__ == "__main__":
    main()
