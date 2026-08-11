# Autonomous PSD2 Engine (Agentic)

This repository contains an autonomous PSD2/Open Banking connector engine with:
- self-configure (registry-driven)
- self-connect (mTLS per connector)
- self-test (canary loop)
- automated OAuth2 token refresh (mTLS token endpoint)
- lightweight SQLite persistence and audit
- metrics/health endpoint

Quick start (local):
1. Place your client certificates and CA bundles under ./certs (do NOT commit private keys to git).
2. Edit registry.json to add connectors (token_url, base_url, endpoints).
3. Start:
   - docker-compose up --build
   - or: python engine.py

Metrics:
- GET http://localhost:8080/health

Security notes:
- Never commit private keys/certs into repository.
- Run inside a private network or VPC.
- Use secret manager for production (Vault, AWS KMS, etc.)

Want me to push these files to your repository? I can:
- create a branch (you tell me the name), commit all files, and open a PR; or
- directly commit to default branch if you prefer (not recommended).

What would you like next?
- I can push these files into your repo (create branch: e.g. `autonomous-psd2/starter`) and open a PR.
- Or I can extend the engine: add Prometheus metrics, structured logging, Kubernetes manifests (Helm), or a web UI for connector management.
