import { NextResponse } from "next/server";
import { ownerGuardStatus } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/security/owner-guard
 *
 * Returns the live beneficiary-guard status for the swarm:
 * enforced, owner legal name, allowlist size (masked), and any recipient
 * records that are NOT verified owner destinations.
 */
export async function GET() {
  try {
    const status = await ownerGuardStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
