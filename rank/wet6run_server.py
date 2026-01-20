import os
import json
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from wet6run.autopilot import run_once

STATE = {"last_run": None, "last_result": None, "running": False}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/admin/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(STATE).encode("utf-8"))
            return
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/admin/run":
            if STATE["running"]:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"started": False, "message": "already running"}).encode("utf-8"))
                return
            threading.Thread(target=server_run_once, daemon=True).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"started": True}).encode("utf-8"))
            return
        self.send_response(404)
        self.end_headers()

def server_run_once():
    try:
        STATE["running"] = True
        domain = os.environ.get("SITE_DOMAIN", "www.realworldcerts.com")
        outdir = os.path.join(BASE_DIR, "output")
        r = run_once(domain, outdir)
        STATE["last_result"] = r if r else {"ok": True}
        STATE["last_run"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    finally:
        STATE["running"] = False

def schedule_loop():
    interval = int(os.environ.get("RUN_INTERVAL_SEC", "3600"))
    while True:
        server_run_once()
        time.sleep(interval)

def main():
    outdir = os.path.join(BASE_DIR, "output")
    os.makedirs(outdir, exist_ok=True)
    try:
        server_run_once()
    except Exception:
        pass
    os.chdir(outdir)
    host = os.environ.get("HOST", "localhost")
    port = int(os.environ.get("PORT", "8000"))
    t = threading.Thread(target=schedule_loop, daemon=True)
    t.start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print("listening", f"http://{host}:{port}/")
    httpd.serve_forever()

if __name__ == "__main__":
    main()
