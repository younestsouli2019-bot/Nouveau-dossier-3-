# Webhook Specification

## Lead Endpoint

POST {LEAD_ENDPOINT}

Content-Type: application/json

Request body:
{
  "email": "user@example.com",
  "sku": "AWS-DVA-001",
  "page": "https://www.realworldcerts.com/courses/aws-developer-associate-course.html",
  "source": "website",
  "timestamp": "2026-01-05T12:00:00Z"
}

Response:
Status: 200
Body:
{
  "ok": true,
  "id": "lead_123"
}

## Purchase Endpoint

POST {ORDER_ENDPOINT}

Content-Type: application/json

Request body:
{
  "sku": "AWS-DVA-001",
  "title": "AWS Developer Associate Course",
  "price": 149,
  "currency": "USD",
  "promo_code": "SAVE10",
  "transaction_id": "txn_abc123",
  "email": "user@example.com",
  "page": "https://www.realworldcerts.com/checkout/",
  "source": "website",
  "timestamp": "2026-01-05T12:05:00Z"
}

Response:
Status: 200
Body:
{
  "ok": true
}
