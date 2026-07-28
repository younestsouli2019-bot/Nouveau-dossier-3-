"""
ChariBaaS Autonomous Gateway - MCP Server
==========================================
Connects swarm revenue ledger to Moroccan banking rails via ChariBaaS API.
Routes MAD settlements to Attijariwafa Bank (routing code 007).

Requires:
  pip install fastmcp httpx python-dotenv

Env vars:
  CHARI_BAAS_SECRET_KEY   - BaaS API bearer token
  BAAS_WALLET_ID          - Source settlement wallet ID on ChariBaaS
  BAAS_ENV                - "sandbox" | "production" (default: sandbox)
"""

import os
import httpx
from datetime import datetime, timezone
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("BaaS_Autonomous_Gateway")

BAAS_ENV = os.environ.get("BAAS_ENV", "sandbox")
BAAS_API_URL = (
    "https://api.baas.ma/v1" if BAAS_ENV == "production"
    else "https://sandbox.baas.ma/v1"
)
BAAS_API_KEY = os.environ.get("CHARI_BAAS_SECRET_KEY", "")
BAAS_WALLET_ID = os.environ.get("BAAS_WALLET_ID", "")

# Attijariwafa Bank routing code (Bank Al-Maghrib interbank code)
ATTIJARI_BANK_CODE = "007"

MAD_MICRO_LIMIT = 50_000
MAD_INSTANT_LIMIT = 20_000


def _headers():
    return {
        "Authorization": f"Bearer {BAAS_API_KEY}",
        "Content-Type": "application/json",
    }


def _clearing_channel(amount: float) -> str:
    if amount <= MAD_INSTANT_LIMIT:
        return "Virement Instantané (Instant)"
    return "Standard Interbank (SPI)"


@mcp.tool()
async def execute_baas_payout(
    swarm_ledger_balance_mad: float,
    payout_amount_mad: float,
    destination_iban: str,
    beneficiary_name: str,
    reference: str = "",
) -> dict:
    """
    Autonomous bankwire payout from swarm revenue pool to a Moroccan
    bank account via ChariBaaS gateway.
    """
    if payout_amount_mad > swarm_ledger_balance_mad:
        return {"status": "REJECTED", "error": "Insufficient funds in swarm ledger."}

    if payout_amount_mad > MAD_MICRO_LIMIT:
        return {
            "status": "REJECTED",
            "error": f"Exceeds hands-free limit ({MAD_MICRO_LIMIT} MAD). Manual approval required.",
        }

    if not BAAS_API_KEY or not BAAS_WALLET_ID:
        return {"status": "REJECTED", "error": "BAAS credentials not configured."}

    payload = {
        "source_account_id": BAAS_WALLET_ID,
        "amount": payout_amount_mad,
        "currency": "MAD",
        "destination": {
            "type": "bank_account",
            "iban": destination_iban.replace(" ", ""),
            "beneficiary_name": beneficiary_name,
            "bank_code": ATTIJARI_BANK_CODE,
        },
        "description": reference or "SWARM_AUTONOMOUS_REVENUE_PAYOUT",
        "idempotency_key": f"swarm-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{int(payout_amount_mad * 100)}",
        "metadata": {
            "automation_layer": "MCP_BaaS_Gateway_v1",
            "execution_mode": "Hands-Free",
        },
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                f"{BAAS_API_URL}/transfers",
                json=payload,
                headers=_headers(),
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                return {
                    "status": "SETTLED",
                    "baas_tracking_id": data.get("transfer_id"),
                    "clearing_channel": _clearing_channel(payout_amount_mad),
                    "amount_mad": payout_amount_mad,
                    "destination_iban": destination_iban,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            return {
                "status": "GATEWAY_ERROR",
                "error_code": resp.status_code,
                "details": resp.text,
            }
        except httpx.RequestError as exc:
            return {"status": "NETWORK_FAILURE", "details": str(exc)}


@mcp.tool()
async def check_baas_balance() -> dict:
    """
    Query the current BaaS wallet balance.
    """
    if not BAAS_API_KEY or not BAAS_WALLET_ID:
        return {"status": "REJECTED", "error": "BAAS credentials not configured."}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{BAAS_API_URL}/accounts/{BAAS_WALLET_ID}/balance",
                headers=_headers(),
            )
            if resp.status_code == 200:
                return resp.json()
            return {"status": "ERROR", "code": resp.status_code, "details": resp.text}
        except httpx.RequestError as exc:
            return {"status": "NETWORK_FAILURE", "details": str(exc)}


@mcp.tool()
async def list_recent_transfers(limit: int = 10) -> dict:
    """
    List recent transfers from the BaaS wallet.
    """
    if not BAAS_API_KEY or not BAAS_WALLET_ID:
        return {"status": "REJECTED", "error": "BAAS credentials not configured."}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{BAAS_API_URL}/accounts/{BAAS_WALLET_ID}/transfers",
                params={"limit": limit},
                headers=_headers(),
            )
            if resp.status_code == 200:
                return resp.json()
            return {"status": "ERROR", "code": resp.status_code, "details": resp.text}
        except httpx.RequestError as exc:
            return {"status": "NETWORK_FAILURE", "details": str(exc)}


if __name__ == "__main__":
    mcp.run()
