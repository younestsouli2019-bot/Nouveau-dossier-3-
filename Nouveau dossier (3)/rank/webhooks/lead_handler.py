import json

def handle(event, context):
    try:
        body = event.get("body")
        if isinstance(body, str):
            data = json.loads(body)
        else:
            data = body or {}
        email = data.get("email", "")
        sku = data.get("sku", "")
        page = data.get("page", "")
        try:
            import os
            base = os.path.join(os.getcwd(), "output", "logs")
            os.makedirs(base, exist_ok=True)
            with open(os.path.join(base, "leads.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps({"email": email, "sku": sku, "page": page, "ts": data.get("timestamp")}) + "\n")
        except Exception:
            pass
        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"ok": True, "email": email, "sku": sku})}
    except Exception as e:
        return {"statusCode": 400, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"ok": False, "error": str(e)})}
