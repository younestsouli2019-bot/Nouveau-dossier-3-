# Changelog — 2026-01-31

- Added hourly Autonomous Scheduler workflow (agents registration, headhunter discovery, autonomous tick, readiness ping, auto-commit/push to main).
- Integrated headhunter discovery into supervisor cycle for continuous agent onboarding.
- Ensured catalogue build runs on schedule; added fallback generation of catalogue_master.pdf to avoid missing artifact.
- Improved readiness reporting and success metrics persistence in data/swarm/success_metrics.json.
- Preserved safety rails: owner routing verification, bunker mode kill switch, and queue-on-missing-keys behavior.
- No secrets committed; workflow relies on organization-level secrets for live readiness checks.

