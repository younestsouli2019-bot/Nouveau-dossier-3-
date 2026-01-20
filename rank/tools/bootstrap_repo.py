import os
import subprocess

def run(cmd, cwd=None):
    subprocess.check_call(cmd, cwd=cwd or os.getcwd())

def main():
    root = os.getcwd()
    # Init if not already
    if not os.path.exists(os.path.join(root, ".git")):
        run(["git", "init"])
    # Use main branch
    try:
        run(["git", "checkout", "-B", "main"])
    except subprocess.CalledProcessError:
        pass
    # Basic identity
    try:
        run(["git", "config", "user.email", "deploy@autobot.local"])
        run(["git", "config", "user.name", "Auto Deploy"])
    except subprocess.CalledProcessError:
        pass
    # Add and commit
    run(["git", "add", "."])
    try:
        run(["git", "commit", "-m", "Initial commit"])
    except subprocess.CalledProcessError:
        pass
    # Optional remote
    repo = os.environ.get("GH_REPO")
    token = os.environ.get("GH_TOKEN")
    if repo and token:
        remote = "https://" + token + "@github.com/" + repo + ".git"
        try:
            run(["git", "remote", "remove", "origin"])
        except subprocess.CalledProcessError:
            pass
        run(["git", "remote", "add", "origin", remote])
        try:
            run(["git", "push", "-u", "origin", "main"])
        except subprocess.CalledProcessError:
            pass
    print("bootstrap completed")

if __name__ == "__main__":
    main()
