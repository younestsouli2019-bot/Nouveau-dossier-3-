import { enforceOwnership } from "./enforceOwnership";

export async function executeSettlement(batch: {
  rail: string;
  destination: string;
  amount: number;
  batchId: string;
}) {
  enforceOwnership(batch.destination);
  return {
    status: "EXECUTED",
    rail: batch.rail,
    destination: batch.destination,
    amount: batch.amount,
    executedAt: new Date().toISOString(),
    batchId: batch.batchId,
  };
}
