-- 2026-08-29 — OWNER INITIATED SCOPE RULE (PO scope: owner-initiated POs only)
-- Commit 6adccb8 added `ownerInitiated` to schema.prisma (ProcurementItem +
-- PurchaseOrder) but never shipped a migration for it. Without this, prod
-- throws "column ownerInitiated does not exist" once strict-procurement /
-- enforcePrepaidPolicy reads it — leaving the prepaid-scope rule inert.
-- Idempotent: IF NOT EXISTS guards make re-runs safe.
ALTER TABLE "ProcurementItem" ADD COLUMN IF NOT EXISTS "ownerInitiated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PurchaseOrder"   ADD COLUMN IF NOT EXISTS "ownerInitiated" BOOLEAN NOT NULL DEFAULT true;