#!/usr/bin/env python3
"""
Autonomous PSD2 Engine - agentic self-configure, self-connect, self-test, token-refresh
Usage: python engine.py
"""
import asyncio
import json
import logging
import os
import sqlite3
import ssl
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
from aiohttp import ClientConnectorCertificateError, ClientSSLError

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Configurable defaults
REGISTRY_PATH = os.getenv("REGISTRY_PATH", "registry.json")
DB_PATH = os.getenv("DB_PATH", "engine_state.sqlite")
CANARY_INTERVAL_SECONDS = int(os.getenv("CANARY_INTERVAL_SECONDS", "60"))
TOKEN_REFRESH_MARGIN = int(os.getenv("TOKEN_REFRESH_MARGIN", "60"))  # seconds before expiry to refresh
HTTP_METRICS_PORT = int(os.getenv("HTTP_METRICS_PORT", "8080"))


# ---------------------------
# Persistence (very small)
# ---------------------------
class StateDB:
    def __init__(self, path: str = DB_PATH):
        self.path = path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.path)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                bank_id TEXT PRIMARY KEY,
                access_token TEXT,
                expires_at INTEGER
            )"""
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit (
                ts INTEGER,
                bank_id TEXT,
                level TEXT,
                message TEXT
            )"""
        )
        conn.commit()
        conn.close()

    def persist_token(self, bank_id: str, token: str, expires_at: int):
        conn = sqlite3.connect(self.path)
        cur = conn.cursor()
        cur.execute("REPLACE INTO tokens (bank_id, access_token, expires_at) VALUES (?, ?, ?)", (bank_id, token, expires_at))
        conn.commit()
        conn.close()

    def load_token(self, bank_id: str) -> Optional[Dict[str, Any]]:
        conn = sqlite3.connect(self.path)
        cur = conn.cursor()
        cur.execute("SELECT access_token, expires_at FROM tokens WHERE bank_id = ?", (bank_id,))
        row = cur.fetchone()
        conn.close()
        if row:
            return {"access_token": row[0], "expires_at": row[1]}
        return None

    def audit(self, bank_id: str, level: str, message: str):
        conn = sqlite3.connect(self.path)
        cur = conn.cursor()
        cur.execute("INSERT INTO audit (ts, bank_id, level, message) VALUES (?, ?, ?, ?)", (int(time.time()), bank_id, level, message))
        conn.commit()
        conn.close()


# ---------------------------
# Registry loader
# ---------------------------
def load_registry(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Registry not found at {path}")
    with open(path, "r") as f:
        return json.load(f)


# ---------------------------
# Data classes
# ---------------------------
@dataclass
class ConnectorMeta:
    bank_id: str
    name: str
    region: str
    base_url: str
    auth_scheme: str
    endpoints: Dict[str, str]
    crypto: Dict[str, str]


# ---------------------------
# mTLS & Session manager
# ---------------------------
class MTLSConnector:
    def __init__(self, meta: ConnectorMeta):
        self.meta = meta
        self.ssl_context = self._make_ssl_context(meta.crypto)
        self._client_session: Optional[aiohttp.ClientSession] = None

    @staticmethod
    def _make_ssl_context(crypto: Dict[str, str]) -> ssl.SSLContext:
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
        # require TLS 1.2+
        try:
            context.minimum_version = ssl.TLSVersion.TLSv1_2
        except Exception:
            pass  # older Python may not have TLSVersion enum
        # load client's cert/key
        certfile = crypto.get("client_cert_path")
        keyfile = crypto.get("private_key_path")
        ca_path = crypto.get("eidas_ca_path") or crypto.get("ca_path")
        if not certfile or not keyfile:
            raise ValueError("client_cert_path and private_key_path are required for mTLS connector")
        context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        if ca_path:
            context.load_verify_locations(cafile=ca_path)
        return context

    async def session(self) -> aiohttp.ClientSession:
        if self._client_session and not self._client_session.closed:
            return self._client_session
        connector = aiohttp.TCPConnector(ssl=self.ssl_context, limit=10)
        self._client_session = aiohttp.ClientSession(connector=connector)
        return self._client_session

    async def close(self):
        if self._client_session:
            await self._client_session.close()


# ---------------------------
# Token refresher (for OAuth2 with mTLS)
# ---------------------------
class TokenRefresher:
    def __init__(self, meta: ConnectorMeta, connector: MTLSConnector, state_db: StateDB):
        self.meta = meta
        self.connector = connector
        self.state_db = state_db
        self._token: Optional[str] = None
        self._expires_at: int = 0
        self._lock = asyncio.Lock()

    async def get_token(self) -> Optional[str]:
        async with self._lock:
            now = int(time.time())
            if self._token and self._expires_at - TOKEN_REFRESH_MARGIN > now:
                return self._token
            # try DB
            data = self.state_db.load_token(self.meta.bank_id)
            if data and data["expires_at"] - TOKEN_REFRESH_MARGIN > now:
                self._token = data["access_token"]
                self._expires_at = data["expires_at"]
                return self._token
            # otherwise refresh
            await self._refresh_token()
            return self._token

    async def _refresh_token(self):
        # This implementation expects the registry to include a token_url and client_id if needed.
        token_url = self.meta.endpoints.get("token_url") or self.meta.endpoints.get("auth_token")
        if not token_url:
            logging.info(f"[TokenRefresher] No token endpoint for {self.meta.bank_id}; skipping token refresh")
            return

        logging.info(f"[TokenRefresher] Refreshing token for {self.meta.bank_id} from {token_url}")
        session = await self.connector.session()
        data = {"grant_type": "client_credentials", "scope": self.meta.endpoints.get("scope", "")}
        headers = {"Accept": "application/json"}
        # Use client cert for mTLS token endpoint (aiohttp will send cert via SSL context)
        try:
            async with session.post(token_url, data=data, headers=headers, timeout=10) as resp:
                j = await resp.json()
                access_token = j.get("access_token")
                expires_in = j.get("expires_in", 3600)
                if access_token:
                    self._token = access_token
                    self._expires_at = int(time.time()) + int(expires_in)
                    self.state_db.persist_token(self.meta.bank_id, self._token, self._expires_at)
                    logging.info(f"[TokenRefresher] Obtained token for {self.meta.bank_id} (exp in {expires_in}s)")
                    self.state_db.audit(self.meta.bank_id, "INFO", "token_refreshed")
                else:
                    logging.error(f"[TokenRefresher] Failed token refresh for {self.meta.bank_id}: {j}")
                    self.state_db.audit(self.meta.bank_id, "ERROR", f"token_refresh_failed:{j}")
        except (ClientSSLError, ClientConnectorCertificateError) as e:
            logging.error(f"[TokenRefresher] mTLS error while refreshing token for {self.meta.bank_id}: {e}")
            self.state_db.audit(self.meta.bank_id, "ERROR", f"mTLS_token_err:{e}")
        except Exception as e:
            logging.error(f"[TokenRefresher] Error refreshing token for {self.meta.bank_id}: {e}")
            self.state_db.audit(self.meta.bank_id, "ERROR", f"token_err:{e}")


# ---------------------------
# Self tester (canary)
# ---------------------------
class SelfTester:
    def __init__(self, meta: ConnectorMeta, connector: MTLSConnector, token_refresher: Optional[TokenRefresher], state_db: StateDB):
        self.meta = meta
        self.connector = connector
        self.token_refresher = token_refresher
        self.state_db = state_db

    async def run_canary_once(self) -> bool:
        # choose AIS endpoint as default canary
        test_url = self._resolve_url(self.meta.base_url, self.meta.endpoints.get("ais_path") or self.meta.endpoints.get("ais"))
        headers = {"X-Request-ID": f"engine-canary-{int(time.time())}"}
        session = await self.connector.session()
        params = {}
        token = None
        if self.token_refresher:
            token = await self.token_refresher.get_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"

        try:
            async with session.get(test_url, headers=headers, params=params, timeout=8) as resp:
                status = resp.status
                if status in (200, 201, 401, 403):
                    logging.info(f"[SelfTester] Canary OK for {self.meta.bank_id} -> {status}")
                    self.state_db.audit(self.meta.bank_id, "INFO", f"canary_ok:{status}")
                    return True
                logging.warning(f"[SelfTester] Canary unhealthy for {self.meta.bank_id} -> {status}")
                self.state_db.audit(self.meta.bank_id, "WARN", f"canary_status:{status}")
                return False
        except (ClientSSLError, ClientConnectorCertificateError) as ssl_err:
            logging.error(f"[SelfTester] mTLS handshake failed for {self.meta.bank_id}: {ssl_err}")
            self.state_db.audit(self.meta.bank_id, "ERROR", f"mtls_err:{ssl_err}")
            return False
        except asyncio.TimeoutError:
            logging.error(f"[SelfTester] Timeout probing {self.meta.bank_id}")
            self.state_db.audit(self.meta.bank_id, "ERROR", "canary_timeout")
            return False
        except Exception as e:
            logging.error(f"[SelfTester] Network error probing {self.meta.bank_id}: {e}")
            self.state_db.audit(self.meta.bank_id, "ERROR", f"canary_net:{e}")
            return False

    @staticmethod
    def _resolve_url(base: str, path: Optional[str]) -> str:
        if not path:
            return base
        if base.endswith("/") and path.startswith("/"):
            return base + path[1:]
        if not base.endswith("/") and not path.startswith("/"):
            return base + "/" + path
        return base + path


# ---------------------------
# Orchestrator
# ---------------------------
class AutonomousEngine:
    def __init__(self, registry_path: str = REGISTRY_PATH):
        self.registry_path = registry_path
        self.registry: Dict[str, Any] = load_registry(registry_path)
        self.state_db = StateDB()
        self.connectors: Dict[str, MTLSConnector] = {}
        self.token_refreshers: Dict[str, TokenRefresher] = {}
        self.self_testers: Dict[str, SelfTester] = {}
        self.tasks = []

    def _meta_from_entry(self, bank_id: str, entry: Dict[str, Any]) -> ConnectorMeta:
        endpoints = entry.get("endpoints", {})
        # normalize token endpoint if present
        if "token_url" not in endpoints and "auth_token" in endpoints:
            endpoints["token_url"] = endpoints["auth_token"]
        return ConnectorMeta(
            bank_id=bank_id,
            name=entry.get("name"),
            region=entry.get("region"),
            base_url=entry.get("base_url"),
            auth_scheme=entry.get("auth_scheme"),
            endpoints=endpoints,
            crypto=entry.get("crypto", {}),
        )

    async def prepare_connector(self, bank_id: str):
        entry = self.registry.get(bank_id)
        if not entry:
            raise ValueError(f"Unknown bank: {bank_id}")
        meta = self._meta_from_entry(bank_id, entry)
        connector = MTLSConnector(meta)
        self.connectors[bank_id] = connector
        token_ref = TokenRefresher(meta, connector, self.state_db) if "token_url" in meta.endpoints or meta.auth_scheme else None
        self.token_refreshers[bank_id] = token_ref
        tester = SelfTester(meta, connector, token_ref, self.state_db)
        self.self_testers[bank_id] = tester
        logging.info(f"[Orchestrator] Prepared connector for {bank_id}")

    async def run_pipeline_for(self, bank_id: str):
        await self.prepare_connector(bank_id)
        # one-time connect & initial token fetch
        token_ref = self.token_refreshers.get(bank_id)
        if token_ref:
            await token_ref.get_token()
        # schedule recurring canary & token refresh
        self.tasks.append(asyncio.create_task(self._canary_loop(bank_id)))
        if token_ref:
            self.tasks.append(asyncio.create_task(self._token_refresh_loop(bank_id)))

    async def _canary_loop(self, bank_id: str):
        tester = self.self_testers[bank_id]
        backoff = 1
        while True:
            ok = await tester.run_canary_once()
            if ok:
                backoff = 1
            else:
                # exponential backoff capped
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)
            await asyncio.sleep(CANARY_INTERVAL_SECONDS)

    async def _token_refresh_loop(self, bank_id: str):
        token_ref = self.token_refreshers[bank_id]
        while True:
            try:
                await token_ref.get_token()
            except Exception as e:
                logging.error(f"[TokenLoop] Error refreshing token for {bank_id}: {e}")
            # sleep until next check; token_ref will early-return if fine
            await asyncio.sleep(max(30, CANARY_INTERVAL_SECONDS))

    async def shutdown(self):
        # cancel tasks and close sessions
        for t in self.tasks:
            t.cancel()
        for c in self.connectors.values():
            await c.close()


# ---------------------------
# Minimal HTTP metrics/health endpoint
# ---------------------------
from aiohttp import web  # placed here to avoid import noise if module unused


async def make_metrics_app(engine: AutonomousEngine):
    async def health(request):
        # Simple health: list connectors and last token expiry
        data = []
        for bank_id, meta in engine.registry.items():
            tok = engine.state_db.load_token(bank_id)
            data.append(
                {
                    "bank_id": bank_id,
                    "name": meta.get("name"),
                    "has_token": bool(tok),
                    "token_expires_at": tok["expires_at"] if tok else None,
                }
            )
        return web.json_response({"ok": True, "connectors": data})

    app = web.Application()
    app.add_routes([web.get("/health", health)])
    return app


# ---------------------------
# CLI / Entrypoint
# ---------------------------
async def main():
    engine = AutonomousEngine()
    # auto-run pipeline for all connectors in registry (agentic)
    tasks = []
    for bank_id in engine.registry.keys():
        tasks.append(asyncio.create_task(engine.run_pipeline_for(bank_id)))
    # metrics server
    app = await make_metrics_app(engine)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", HTTP_METRICS_PORT)
    await site.start()
    logging.info(f"[Main] Metrics server running on :{HTTP_METRICS_PORT}")
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        await engine.shutdown()
        await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Shutting down")
