import os
import zipfile
from ftplib import FTP, error_perm
import shutil
import subprocess
import tempfile

def zip_output(outdir, zip_path):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(outdir):
            for f in files:
                p = os.path.join(root, f)
                rel = os.path.relpath(p, outdir)
                z.write(p, rel)
    return zip_path

def ftp_mkdir_p(ftp, path):
    parts = [x for x in path.split("/") if x]
    cur = ""
    for p in parts:
        cur = cur + "/" + p
        try:
            ftp.mkd(cur)
        except error_perm as e:
            pass

def ftp_upload_dir(outdir, host, user, passwd, base="/"):
    ftp = FTP(host)
    ftp.login(user=user, passwd=passwd)
    ftp.cwd(base)
    for root, dirs, files in os.walk(outdir):
        rel = os.path.relpath(root, outdir).replace("\\", "/")
        remote = base if rel == "." else (base.rstrip("/") + "/" + rel)
        ftp_mkdir_p(ftp, remote)
        ftp.cwd(remote)
        for f in files:
            p = os.path.join(root, f)
            with open(p, "rb") as fh:
                ftp.storbinary("STOR " + f, fh)
        ftp.cwd(base)
    ftp.quit()
    return True

def gh_pages_publish(outdir, repo, token=None, domain=None, use_gcm=False):
    tmp = tempfile.mkdtemp(prefix="ghpages_")
    try:
        # copy contents
        for name in os.listdir(outdir):
            src = os.path.join(outdir, name)
            dst = os.path.join(tmp, name)
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        # add CNAME
        if domain:
            with open(os.path.join(tmp, "CNAME"), "w", encoding="utf-8") as f:
                f.write(domain.strip())
        # git init and push
        subprocess.check_call(["git", "init"], cwd=tmp)
        subprocess.check_call(["git", "checkout", "--orphan", "gh-pages"], cwd=tmp)
        # set minimal identity
        subprocess.check_call(["git", "config", "user.email", "deploy@autobot.local"], cwd=tmp)
        subprocess.check_call(["git", "config", "user.name", "Auto Deploy"], cwd=tmp)
        subprocess.check_call(["git", "add", "."], cwd=tmp)
        subprocess.check_call(["git", "commit", "-m", "Deploy site"], cwd=tmp)
        if use_gcm or not token:
            remote = "https://github.com/" + repo + ".git"
        else:
            remote = "https://" + token + "@github.com/" + repo + ".git"
        subprocess.check_call(["git", "remote", "add", "origin", remote], cwd=tmp)
        subprocess.check_call(["git", "push", "-f", "origin", "gh-pages"], cwd=tmp)
        return True
    except Exception:
        return False
    finally:
        try:
            shutil.rmtree(tmp)
        except Exception:
            pass

def pipeline(outdir, domain=None):
    zip_path = os.path.join(outdir, "site.zip")
    zip_output(outdir, zip_path)
    host = os.environ.get("FTP_HOST")
    user = os.environ.get("FTP_USER")
    passwd = os.environ.get("FTP_PASS")
    base = os.environ.get("FTP_BASE_PATH", "/")
    gh_repo = os.environ.get("GH_REPO")
    gh_token = os.environ.get("GH_TOKEN")
    use_gcm = os.environ.get("USE_GCM", "").lower() in ("1", "true", "yes")
    domain = domain or os.environ.get("SITE_DOMAIN")
    if host and user and passwd:
        ftp_upload_dir(outdir, host, user, passwd, base)
        return {"zip": zip_path, "uploaded": True, "method": "ftp"}
    if gh_repo and (gh_token or use_gcm):
        ok = gh_pages_publish(outdir, gh_repo, gh_token, domain, use_gcm=use_gcm)
        return {"zip": zip_path, "uploaded": ok, "method": "gh-pages"}
    return {"zip": zip_path, "uploaded": False, "method": None}
