import os
from wet6run.analytics import pipeline

def main():
    outdir = os.path.join(os.getcwd(), "output")
    r = pipeline(outdir)
    print("injected analytics into", r["updated"], "pages")

if __name__ == "__main__":
    main()
