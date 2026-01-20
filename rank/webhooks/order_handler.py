import json

def handle(event, context):
    try:
        body = event.get("body")
        if isinstance(body, str):
            data = json.loads(body)
        else:
            data = body or {}
        txn = data.get("transaction_id", "")
        total = data.get("price", 0)
        currency = data.get("currency", "USD")
        sku = data.get("sku", "")
        email = data.get("email", "")
        try:
            import os
            base = os.path.join(os.getcwd(), "output", "logs")
            os.makedirs(base, exist_ok=True)
            with open(os.path.join(base, "orders.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps({"transaction_id": txn, "price": total, "currency": currency, "sku": sku, "email": email, "ts": data.get("timestamp")}) + "\n")
        except Exception:
            pass
        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"ok": True, "transaction_id": txn, "price": total, "currency": currency, "sku": sku, "email": email})}
    except Exception as e:
        return {"statusCode": 400, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"ok": False, "error": str(e)})}
