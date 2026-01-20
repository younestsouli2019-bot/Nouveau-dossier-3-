import os
import json
import requests

def main():
    token = os.environ.get("GH_TOKEN")
    name = os.environ.get("GH_NEW_REPO", "realworldcerts")
    private = True
    if not token:
        print("missing GH_TOKEN")
        return
    r = requests.post(
        "https://api.github.com/user/repos",
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"},
        json={"name": name, "private": private, "description": "Real World Certs static site"}
    )
    print("status", r.status_code)
    print(r.text)

if __name__ == "__main__":
    main()
