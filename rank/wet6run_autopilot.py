import os
from wet6run.autopilot import run_once

def main():
    domain = os.environ.get("SITE_DOMAIN", "www.realworldcerts.com")
    outdir = os.path.join(os.getcwd(), "output")
    run_once(domain, outdir)
    print("autopilot run completed for", domain)

if __name__ == "__main__":
    main()
