# Changelog — 2026-02-01

- Scheduler: Hourly autonomous workflow executes agent registration, headhunter discovery, autonomous tick, readiness ping, catalogue build (with fallback), truth marker write, and auto-commit/push.
- Supervisor: Headhunter discovery integrated into cycle to continuously onboard hidden gem agents.
- Env: Added local .env loader and optional NaCl secretbox decrypt for encrypted env usage during development.
- Org: Added broadcast workflow to send repository_dispatch (agentic_tick) across org repos using gh CLI with ORG_PAT.
- Outputs: Ensured catalogue_master.pdf generation; fallback placeholder used only if assets missing.
- Guardrails: Owner routing and bunker mode kill switch enforced; no secrets committed to repo.

