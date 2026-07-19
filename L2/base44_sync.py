#!/usr/bin/env python3
"""
Base44 API Sync Script
Pushes AgentFlow and Mission CSV exports to the Base44 application via REST API.
"""

import csv
import json
import requests
import sys
import time
from datetime import datetime

# === Configuration ===
APP_ID = "6888b07f858ab838a3b85ae2"
API_KEY = "e599b5b131574c1bae885fc013620739"
BASE_URL = "https://base44.app/api"

HEADERS = {
    "Content-Type": "application/json",
    "X-App-Id": APP_ID,
    "api_key": API_KEY,
}

AGENTFLOW_ENDPOINT = f"{BASE_URL}/apps/{APP_ID}/entities/AgentFlow"
MISSION_ENDPOINT = f"{BASE_URL}/apps/{APP_ID}/entities/Mission"


def load_csv(filepath):
    """Load CSV file and return list of dicts."""
    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def api_call(method, url, data=None, params=None):
    """Make an API call with error handling."""
    try:
        resp = requests.request(method, url, headers=HEADERS, json=data, params=params, timeout=30)
        return resp.status_code, resp.json() if resp.text else {}
    except requests.exceptions.Timeout:
        return 408, {"error": "Request timed out"}
    except Exception as e:
        return 500, {"error": str(e)}


def check_existing_records(endpoint, entity_name):
    """Check what records already exist for an entity."""
    print(f"\n📋 Checking existing {entity_name} records...")
    status, data = api_call("GET", endpoint, params={"limit": 100})
    if status == 200:
        records = data if isinstance(data, list) else data.get("data", data.get("results", []))
        if isinstance(records, dict):
            records = records.get("data", records.get("results", []))
        print(f"   Found {len(records)} existing {entity_name} records")
        return {r.get("id"): r for r in records if isinstance(r, dict) and r.get("id")}
    else:
        print(f"   ⚠ Could not fetch existing records: {status} - {data}")
        return {}


def push_agentflow_data(csv_path):
    """Push AgentFlow CSV data to the API."""
    print("\n" + "="*60)
    print("🔄 SYNCING AGENTFLOW DATA")
    print("="*60)

    records = load_csv(csv_path)
    if not records:
        print("   No AgentFlow records found in CSV")
        return

    print(f"   Loaded {len(records)} AgentFlow records from CSV")

    # Check existing records
    existing = check_existing_records(AGENTFLOW_ENDPOINT, "AgentFlow")

    created = 0
    updated = 0
    errors = 0

    for i, record in enumerate(records):
        record_id = record.get("id", "")

        # Build payload matching AgentFlow schema
        payload = {
            "name": record.get("name", ""),
            "description": record.get("description", ""),
            "category": record.get("category", "custom"),
            "status": record.get("status", "draft"),
            "is_template": record.get("is_template", "false").lower() == "true",
            "template_price": float(record.get("template_price", 0)),
        }

        # Parse JSON fields
        try:
            flow_data = json.loads(record.get("flow_data", "{}")) if record.get("flow_data") else {}
            payload["flow_data"] = flow_data
        except json.JSONDecodeError:
            payload["flow_data"] = {}

        try:
            perf = json.loads(record.get("performance_metrics", "{}")) if record.get("performance_metrics") else {}
            payload["performance_metrics"] = perf
        except json.JSONDecodeError:
            payload["performance_metrics"] = {}

        try:
            tags = json.loads(record.get("tags", "[]")) if record.get("tags") else []
            payload["tags"] = tags
        except json.JSONDecodeError:
            payload["tags"] = []

        if record_id and record_id in existing:
            # Update existing record
            status, resp = api_call("PUT", f"{AGENTFLOW_ENDPOINT}/{record_id}", data=payload)
            if 200 <= status < 300:
                updated += 1
                print(f"   ✅ Updated: {payload['name']} ({record_id})")
            else:
                errors += 1
                print(f"   ❌ Failed to update {payload['name']}: {status} - {resp}")
        else:
            # Create new record
            status, resp = api_call("POST", AGENTFLOW_ENDPOINT, data=payload)
            if 200 <= status < 300:
                created += 1
                new_id = resp.get("id", resp.get("_id", "?"))
                print(f"   ✅ Created: {payload['name']} (new id: {new_id})")
            else:
                errors += 1
                print(f"   ❌ Failed to create {payload['name']}: {status} - {resp}")

    print(f"\n   📊 AgentFlow Summary: {created} created, {updated} updated, {errors} errors")


def push_mission_data(csv_path):
    """Push Mission CSV data to the API by converting to AgentFlow-compatible records."""
    print("\n" + "="*60)
    print("🔄 SYNCING MISSION DATA → AGENTFLOW")
    print("="*60)

    records = load_csv(csv_path)
    if not records:
        print("   No Mission records found in CSV")
        return

    print(f"   Loaded {len(records)} Mission records from CSV")

    # First try the Mission entity endpoint
    print("\n   🔍 Checking if Mission entity exists...")
    status, data = api_call("GET", MISSION_ENDPOINT, params={"limit": 1})
    mission_entity_exists = (status == 200)

    if mission_entity_exists:
        print(f"   ✅ Mission entity found! Pushing directly...")
        existing = check_existing_records(MISSION_ENDPOINT, "Mission")

        created = 0
        updated = 0
        errors = 0

        for i, record in enumerate(records):
            record_id = record.get("id", "")

            payload = {
                "goal": record.get("goal", ""),
                "status": record.get("status", "paused"),
                "is_sample": record.get("is_sample", "false").lower() == "true",
                "last_step_result": record.get("last_step_result", ""),
            }

            # Parse metrics JSON
            try:
                metrics = json.loads(record.get("metrics", "{}")) if record.get("metrics") else {}
                payload["metrics"] = metrics
            except json.JSONDecodeError:
                payload["metrics"] = {}

            # Parse log JSON
            try:
                log = json.loads(record.get("log", "[]")) if record.get("log") else []
                payload["log"] = log
            except json.JSONDecodeError:
                payload["log"] = []

            if record_id and record_id in existing:
                status, resp = api_call("PUT", f"{MISSION_ENDPOINT}/{record_id}", data=payload)
                if 200 <= status < 300:
                    updated += 1
                    goal_short = payload["goal"][:60]
                    print(f"   ✅ Updated Mission: {goal_short}... ({record_id})")
                else:
                    errors += 1
                    print(f"   ❌ Failed to update Mission {record_id}: {status} - {resp}")
            else:
                status, resp = api_call("POST", MISSION_ENDPOINT, data=payload)
                if 200 <= status < 300:
                    created += 1
                    new_id = resp.get("id", resp.get("_id", "?"))
                    goal_short = payload["goal"][:60]
                    print(f"   ✅ Created Mission: {goal_short}... (new id: {new_id})")
                else:
                    errors += 1
                    print(f"   ❌ Failed to create Mission: {status} - {resp}")

        print(f"\n   📊 Mission Summary: {created} created, {updated} updated, {errors} errors")
    else:
        print(f"   ⚠ Mission entity not found (status: {status})")
        print(f"   Converting Mission data to AgentFlow records...")

        # Map Mission fields to AgentFlow schema
        existing = check_existing_records(AGENTFLOW_ENDPOINT, "AgentFlow")

        created = 0
        updated = 0
        errors = 0
        skipped = 0

        for i, record in enumerate(records):
            record_id = record.get("id", "")
            goal = record.get("goal", "Unnamed Mission")
            status_val = record.get("status", "paused")

            # Map Mission status to AgentFlow status
            status_map = {
                "running": "active",
                "paused": "paused",
                "failed": "draft",
                "completed": "archived",
                "draft": "draft",
            }
            af_status = status_map.get(status_val, "draft")

            # Determine category from goal content
            goal_lower = goal.lower()
            if any(kw in goal_lower for kw in ["market", "promot", "ad ", "campaign", "social media", "traffic"]):
                category = "marketing"
            elif any(kw in goal_lower for kw in ["research", "sourc", "identif"]):
                category = "research"
            elif any(kw in goal_lower for kw in ["content", "blog", "creat"]):
                category = "content"
            elif any(kw in goal_lower for kw in ["ecommerce", "store", "inventory", "fulfill", "order"]):
                category = "ecommerce"
            elif any(kw in goal_lower for kw in ["analytics", "data warehouse", "monitor", "watchdog"]):
                category = "analytics"
            elif any(kw in goal_lower for kw in ["tax", "compliance", "fraud", "security", "banking", "financial"]):
                category = "custom"
            elif any(kw in goal_lower for kw in ["api", "integration", "config", "setup", "system"]):
                category = "custom"
            else:
                category = "custom"

            # Parse metrics
            try:
                metrics = json.loads(record.get("metrics", "{}")) if record.get("metrics") else {}
            except json.JSONDecodeError:
                metrics = {}

            # Parse log for tags
            tags = []
            goal_words = goal.split()
            for word in goal_words[:5]:
                clean = word.strip(".,:;-\"'()").lower()
                if len(clean) > 3:
                    tags.append(clean)
            tags = list(set(tags))[:5]

            payload = {
                "name": goal[:80] + ("..." if len(goal) > 80 else ""),
                "description": goal,
                "category": category,
                "status": af_status,
                "is_template": False,
                "template_price": 0,
                "flow_data": {"original_mission_id": record_id, "source": "mission_export"},
                "performance_metrics": metrics,
                "tags": tags,
            }

            # Check if already exists by description
            matching = [eid for eid, erec in existing.items()
                        if isinstance(erec, dict) and erec.get("description") == goal]
            
            if matching:
                # Update existing
                eid = matching[0]
                status, resp = api_call("PUT", f"{AGENTFLOW_ENDPOINT}/{eid}", data=payload)
                if 200 <= status < 300:
                    updated += 1
                    print(f"   ✅ Updated (from Mission): {goal[:60]}... → {eid}")
                else:
                    errors += 1
                    print(f"   ❌ Failed to update: {goal[:40]}... - {status} - {resp}")
            else:
                # Create new
                status, resp = api_call("POST", AGENTFLOW_ENDPOINT, data=payload)
                if 200 <= status < 300:
                    created += 1
                    new_id = resp.get("id", resp.get("_id", "?"))
                    print(f"   ✅ Created (from Mission): {goal[:60]}... → {new_id}")
                else:
                    errors += 1
                    print(f"   ❌ Failed to create: {goal[:40]}... - {status} - {resp}")

            time.sleep(0.1)  # Rate limiting

        print(f"\n   📊 Mission→AgentFlow Summary: {created} created, {updated} updated, {errors} errors, {skipped} skipped")


def main():
    print("🚀 Base44 API Sync - Starting")
    print(f"   App ID: {APP_ID}")
    print(f"   Base URL: {BASE_URL}")
    print(f"   Time: {datetime.now().isoformat()}")

    # Verify API connectivity
    print("\n🔗 Testing API connectivity...")
    status, data = api_call("GET", AGENTFLOW_ENDPOINT, params={"limit": 1})
    if 200 <= status < 300:
        print(f"   ✅ API is reachable (status: {status})")
    else:
        print(f"   ⚠ API returned: {status} - {data}")
        print("   Continuing anyway...")

    # Push AgentFlow data
    push_agentflow_data("/home/z/my-project/upload/AgentFlow_export.csv")

    # Push Mission data
    push_mission_data("/home/z/my-project/upload/Mission_export (68).csv")

    print("\n" + "="*60)
    print("🏁 SYNC COMPLETE")
    print("="*60)


if __name__ == "__main__":
    main()
