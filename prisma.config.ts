import { defineConfig } from "prisma/config";

const base = process.env.DATABASE_URL ?? "file:./db/custom.db";
const isSqlite = base.startsWith("file:");

// Only append tuning params for Postgres; SQLite URLs don't accept query params
const sep = base.includes("?") ? "&" : "?";
const caps = "connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm";
const url = isSqlite ? base : `${base}${sep}${caps}`;

export default defineConfig({
  datasource: {
    url,
  },
});
