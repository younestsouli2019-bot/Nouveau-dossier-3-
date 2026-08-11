# SCSS Prototype

This repository contains a minimal prototype of the Self-Connector & Self-Synchronizer (SCSS) architecture described in the blueprint. It provides a local, event-driven simulation with:

- AsyncEventBus (Redis-backed pub/sub and a dead-letter queue)
- Agent class with telemetry and simple state
- Synchronizer that keeps a topology and a lightweight vector state ledger
- Rectifier with drift detection and dynamic prompt injection (simulated)
- A simulator that demonstrates an agent entering a loop, being isolated by a circuit breaker, and hot-patched by the rectifier

Requirements and run instructions are in the README.
