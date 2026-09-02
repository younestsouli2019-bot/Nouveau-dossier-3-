import { defineConfig } from "prisma/config";

const base = process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder";
const sep = base.includes("?") ? "&" : "?";
const caps = "connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm";

export default defineConfig({
  datasource: {
    url: `${base}${sep}${caps}`,
  },
});
