"""SQLite publish ledger: one row per asset, updated at every stage."""
import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY, project TEXT, status TEXT, video_path TEXT,
  cid TEXT, urls TEXT, detail TEXT, updated_at REAL)"""


class Ledger:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(SCHEMA)

    def record(self, asset_id, project, status, video_path="", cid="", urls=None, detail=""):
        self.db.execute(
            "INSERT OR REPLACE INTO assets VALUES (?,?,?,?,?,?,?,?)",
            (asset_id, project, status, video_path, cid,
             json.dumps(urls or {}), detail, time.time()),
        )
        self.db.commit()

    def status(self, asset_id):
        row = self.db.execute(
            "SELECT status FROM assets WHERE asset_id=?", (asset_id,)
        ).fetchone()
        return row[0] if row else None
