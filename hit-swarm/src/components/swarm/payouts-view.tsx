"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Banknote, CircleDollarSign, ShieldCheck, ShieldAlert } from "./icons";
import type { SwarmState } from "@/lib/orchestrator";
import type { OwnerGuardStatusPayload } from "./owner-guard-badge";
import {
  EmptyState,
  KpiCard,
  SectionHeader,
  StatusBadge,
  fmtNum,
  fmtUsd,
  timeAgo,
} from "./primitives";

function BeneficiaryGuardCard() {
  const { data } = useQuery<OwnerGuardStatusPayload>({
    queryKey: ["owner-guard"],
    queryFn: async () => {
      const r = await fetch("/api/security/owner-guard", { cache: "no-store" });
      if (!r.ok) throw new Error(`owner-guard fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const locked = !!data && data.allowlistCount === 0;
  const hasViolations = !!data && data.violations.length > 0;
  const tone = hasViolations
    ? "border-rose-500/40 bg-rose-500/5"
    : locked
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-emerald-500/40 bg-emerald-500/5";

  return (
    <Card className={tone}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {hasViolations ? (
            <ShieldAlert className="h-4 w-4 text-rose-300" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
          )}
          Beneficiary guard — owner only
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {!data ? (
          <p>Checking guard status…</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  "font-mono text-[10px] " +
                  (hasViolations
                    ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                    : locked
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30")
                }
              >
                {hasViolations
                  ? `${data.violations.length} non-owner recipient(s) blocked`
                  : locked
                    ? "no owner config — payouts locked (fail-closed)"
                    : "ENFORCED"}
              </Badge>
              <span>
                beneficiary: <span className="text-foreground/80">{data.ownerLegalName}</span>
              </span>
              <span className="font-mono">{data.allowlistCount} allowed id(s)</span>
            </div>
            {data.allowlistMasked.length > 0 && (
              <p className="font-mono text-[10px] text-muted-foreground/70">
                {data.allowlistMasked.join(" · ")}
              </p>
            )}
            {hasViolations && (
              <ul className="space-y-1 text-[11px] text-rose-300">
                {data.violations.map((v, i) => (
                  <li key={i}>
                    {v.recipient_name} ({v.identifier}) — {v.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PayoutsView({ state }: { state: SwarmState }) {
  const { payoutBatches, payoutItems, payoutRecipients, kpis } = state;
  const totalPaid = payoutBatches.reduce((s, b) => s + (b.total_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Total paid out"
          value={fmtUsd(totalPaid)}
          delta={`${payoutBatches.length} batch(es)`}
          icon={Banknote}
          accent="teal"
        />
        <KpiCard
          label="Open batches"
          value={fmtNum(kpis.openPayoutBatches)}
          delta="awaiting completion"
          icon={CircleDollarSign}
          accent="amber"
        />
        <KpiCard
          label="Payout items"
          value={fmtNum(payoutItems.length)}
          delta={`${payoutItems.filter((i) => i.status === "success").length} succeeded`}
          icon={Banknote}
          accent="emerald"
        />
        <KpiCard
          label="Recipients"
          value={fmtNum(payoutRecipients.length)}
          delta={`${payoutRecipients.filter((r) => r.is_default).length} default`}
          icon={CircleDollarSign}
          accent="violet"
        />
      </div>

      <BeneficiaryGuardCard />

      <SectionHeader
        title="Payout batches"
        subtitle="When confirmed revenue crosses $25 on a stream, the orchestrator sweeps it into a payout batch."
      />

      <Card className="bg-card/60">
        <CardContent className="p-0">
          <ScrollArea className="max-h-[440px] slim-scroll">
            {payoutBatches.length === 0 ? (
              <EmptyState
                title="No payouts yet"
                hint="Keep the swarm running — once available revenue crosses $25 a batch will be created automatically."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
                  <tr className="text-left text-[10px] uppercase text-muted-foreground border-b border-border/40">
                    <th className="py-2 px-3">Batch</th>
                    <th className="py-2 px-3">Amount</th>
                    <th className="py-2 px-3">Items</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Notes</th>
                    <th className="py-2 px-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutBatches.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-border/20 hover:bg-background/30"
                    >
                      <td className="py-2 px-3 font-mono text-xs">
                        {b.batch_id || b.id?.slice(-8)}
                      </td>
                      <td className="py-2 px-3 font-mono text-emerald-300">
                        {fmtUsd(b.total_amount ?? 0)}{" "}
                        <span className="text-[10px] text-muted-foreground">
                          {b.currency}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {fmtNum(b.item_count ?? 0)}
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="py-2 px-3 text-[11px] text-muted-foreground max-w-md truncate">
                        {b.notes || "—"}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-muted-foreground whitespace-nowrap">
                        {timeAgo(b.created_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent payout items</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="max-h-72 slim-scroll">
              {payoutItems.length === 0 ? (
                <EmptyState title="No items yet" />
              ) : (
                <ul className="space-y-1.5">
                  {payoutItems.slice(0, 20).map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/30 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          {it.recipient_name || it.recipient}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {it.item_id} • {it.recipient_type.replace(/_/g, " ")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-emerald-300">
                          {fmtUsd(it.amount)}
                        </div>
                        <StatusBadge status={it.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Payout recipients</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {payoutRecipients.length === 0 ? (
              <EmptyState title="No recipients configured" />
            ) : (
              <ul className="space-y-1.5">
                {payoutRecipients.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate flex items-center gap-2">
                        {r.name}
                        {r.is_default && (
                          <Badge className="text-[9px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                            default
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {r.recipient_type.replace(/_/g, " ")} • {r.currency} • {r.account_identifier}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground">
                        {r.country || "—"}
                      </div>
                      {r.bank_name && (
                        <div className="text-[10px] text-muted-foreground/70">
                          {r.bank_name}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
