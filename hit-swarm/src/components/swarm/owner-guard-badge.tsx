"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export interface OwnerGuardStatusPayload {
  enforced: boolean;
  ownerLegalName: string;
  allowlistCount: number;
  allowlistMasked: string[];
  violations: Array<{
    recipient_name: string;
    identifier: string;
    reason: string;
  }>;
}

/**
 * Live badge showing the owner-only beneficiary guard status.
 * Fetches /api/security/owner-guard every few seconds.
 */
export function OwnerGuardBadge() {
  const { data, isError, isLoading } = useQuery<OwnerGuardStatusPayload>({
    queryKey: ["owner-guard"],
    queryFn: async () => {
      const r = await fetch("/api/security/owner-guard", { cache: "no-store" });
      if (!r.ok) throw new Error(`owner-guard fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  if (isLoading || (!data && !isError)) {
    return (
      <Badge
        variant="outline"
        className="font-mono text-[9px] bg-slate-500/10 text-slate-300 border-slate-500/30"
      >
        guard… checking
      </Badge>
    );
  }
  if (isError || !data) {
    return (
      <Badge
        variant="outline"
        className="font-mono text-[9px] bg-rose-500/15 text-rose-300 border-rose-500/30"
      >
        <ShieldAlert className="h-2.5 w-2.5 mr-1" />
        guard unreachable
      </Badge>
    );
  }

  const hasViolations = data.violations.length > 0;
  const locked = data.allowlistCount === 0;

  return (
    <Badge
      variant="outline"
      title={
        locked
          ? "No owner configuration found — payouts are locked (fail-closed)."
          : hasViolations
            ? `Non-owner recipients found: ${data.violations
                .map((v) => v.identifier)
                .join(", ")}`
            : `Revenue settles only to ${data.ownerLegalName} (${data.allowlistCount} allowed identifiers).`
      }
      className={
        "font-mono text-[9px] gap-1 " +
        (hasViolations
          ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
          : locked
            ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
            : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30")
      }
    >
      {hasViolations ? (
        <ShieldAlert className="h-2.5 w-2.5" />
      ) : (
        <ShieldCheck className="h-2.5 w-2.5" />
      )}
      {hasViolations
        ? `guard · ${data.violations.length} blocked`
        : locked
          ? "guard · locked"
          : "beneficiary · owner-only"}
    </Badge>
  );
}
