#!/bin/sh
# docker-entrypoint.sh — Space-Z FC container entry point
set -e
echo "[entrypoint] Starting HIT Swarm container ..."
if [ ! -d "node_modules/.prisma/client" ]; then
  echo "[entrypoint] Generating Prisma client ..."
  npx prisma generate || echo "[entrypoint] WARN: prisma generate failed"
fi
if echo "${DATABASE_URL:-}" | grep -q "postgres"; then
  echo "[entrypoint] Running Prisma migrations (PostgreSQL) ..."
  npx prisma migrate deploy || echo "[entrypoint] WARN: migrate deploy failed"
fi
echo "[entrypoint] Starting Next.js server on port ${PORT:-3000} ..."
exec node server.js
