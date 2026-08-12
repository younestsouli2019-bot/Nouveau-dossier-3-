"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SwarmState, TickReport } from "@/lib/orchestrator";

/** Fetch the aggregated swarm state. */
export function useSwarmState(enabled = true, refetchMs = 4000) {
  return useQuery<SwarmState>({
    queryKey: ["swarm-state"],
    queryFn: async () => {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
      return (await r.json()) as SwarmState;
    },
    enabled,
    refetchInterval: refetchMs,
    staleTime: 2000,
  });
}

/** Run a single orchestration tick. */
export function useTick() {
  const qc = useQueryClient();
  return useMutation<TickReport, Error, void>({
    mutationFn: async () => {
      const r = await fetch("/api/orchestrator/tick", {
        method: "POST",
      });
      if (!r.ok) throw new Error(`tick failed: ${r.status}`);
      return (await r.json()) as TickReport;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["swarm-state"] });
    },
  });
}

/** Autopilot: run a tick every `intervalMs` while ON. */
export function useAutopilot(intervalMs = 6000) {
  const [on, setOn] = useState(false);
  const tick = useTick();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!on) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    const run = () => tick.mutate();
    run();
    timer.current = setInterval(run, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, intervalMs]);

  return {
    on,
    setOn,
    isTicking: tick.isPending,
    lastReport: tick.data,
    lastError: tick.error,
  };
}

export function useToggleAgent() {
  const qc = useQueryClient();
  return useMutation<{ id: string; status: string }, Error, string>({
    mutationFn: async (agentId) => {
      const r = await fetch(`/api/agents/toggle?id=${agentId}`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`toggle failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["swarm-state"] });
    },
  });
}

export function useIngestHits() {
  const qc = useQueryClient();
  return useMutation<{ ingested: number }, Error, void>({
    mutationFn: async () => {
      const r = await fetch("/api/orchestrator/ingest", { method: "POST" });
      if (!r.ok) throw new Error(`ingest failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["swarm-state"] });
    },
  });
}

export function usePreviewHits(enabled = true) {
  return useQuery<{ hits: import("@/lib/hit-market").HIT[] }>({
    queryKey: ["preview-hits"],
    queryFn: async () => {
      const r = await fetch("/api/marketplace/hits?count=12", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`hits fetch failed: ${r.status}`);
      return r.json();
    },
    enabled,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useCreateMission() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, Record<string, unknown>>({
    mutationFn: async (body) => {
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`create mission failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["swarm-state"] });
    },
  });
}
