'use client';

import { useCallback, useEffect, useState } from 'react';

interface Target {
  key: string;
  name: string;
  url: string;
  fatal: boolean;
  code: number;
  ok: boolean;
  latencyMs: number;
}

interface LatestRun {
  id: number;
  status: string;
  conclusion: string;
  createdAt: string;
  message: string;
}

interface DeployState {
  targets: Target[];
  latestRun: LatestRun | null;
  tokenConfigured: boolean;
  repo: string;
  checkedAt: string;
}

const GREEN = '#00ff88';
const RED = '#ff4444';
const AMBER = '#ffaa00';
const CYAN = '#00ccff';
const BG = '#0a0e14';
const PANEL = '#11161f';
const BORDER = '#1e2836';
const TEXT = '#c5d1de';
const MUTED = '#5c7086';

export default function DeployPanel() {
  const [state, setState] = useState<DeployState | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; runId?: number | null; watchUrl?: string; error?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/ops/deploy', { cache: 'no-store' });
      const data = await r.json();
      setState(data);
    } catch {
      // keep old state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 20s while a run is in progress
  useEffect(() => {
    if (state?.latestRun?.status === 'in_progress' || state?.latestRun?.status === 'queued') {
      const t = setInterval(refresh, 20000);
      return () => clearInterval(t);
    }
  }, [state?.latestRun?.status, refresh]);

  // Two-step deploy: first click arms (5s countdown), second click fires
  useEffect(() => {
    if (!confirming) return;
    if (countdown <= 0) { setConfirming(false); setCountdown(5); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [confirming, countdown]);

  const fireDeploy = async () => {
    setDeploying(true);
    setResult(null);
    setConfirming(false);
    setCountdown(5);
    try {
      const r = await fetch('/api/ops/deploy', { method: 'POST' });
      const data = await r.json();
      setResult(data);
      if (data.dispatched) setTimeout(refresh, 3000);
    } catch (e) {
      setResult({ ok: false, message: 'Network error', error: String(e) });
    } finally {
      setDeploying(false);
    }
  };

  const run = state?.latestRun;
  const runColor = run
    ? run.status !== 'completed' ? AMBER : run.conclusion === 'success' ? GREEN : RED
    : MUTED;

  const btnBg = confirming ? '#7a1f1f' : '#0d3b2e';
  const btnBorder = confirming ? RED : GREEN;
  const btnHover = confirming ? '#9a2525' : '#0f4a39';

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '32px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, margin: 0, letterSpacing: 1 }}>
              ⚡ HIT SWARM — DEPLOY CONTROL
            </h1>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              repo: {state?.repo || 'younestsouli2019-bot/Nouveau-dossier-3-'} · branch: main · workflow: deploy-space-z.yml
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            style={{ background: PANEL, border: `1px solid ${BORDER}`, color: CYAN, padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
          >
            {loading ? '⟳ scanning…' : '⟳ refresh status'}
          </button>
        </div>

        {/* THE DEPLOY BUTTON */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 28, marginBottom: 20, textAlign: 'center' }}>
          {!state?.tokenConfigured ? (
            <>
              <div style={{ fontSize: 13, color: AMBER, marginBottom: 12 }}>
                ⚠ DEPLOY_GH_TOKEN not configured — button disabled
              </div>
              <button disabled style={{ opacity: 0.4, fontSize: 22, fontWeight: 700, padding: '22px 72px', borderRadius: 12, background: '#222', border: `2px solid ${MUTED}`, color: MUTED, cursor: 'not-allowed', letterSpacing: 2 }}>
                🚀 DEPLOY
              </button>
            </>
          ) : !confirming ? (
            <>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
                Triggers GitHub Actions: build-verify → trigger-deploy → smoke tests on all 6 targets
              </div>
              <button
                onClick={() => setConfirming(true)}
                disabled={deploying}
                style={{ fontSize: 22, fontWeight: 700, padding: '22px 72px', borderRadius: 12, background: btnBg, border: `2px solid ${btnBorder}`, color: GREEN, cursor: 'pointer', letterSpacing: 2, transition: 'all .15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = btnHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = btnBg)}
              >
                🚀 DEPLOY
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: AMBER, marginBottom: 14 }}>
                ARMED — click again to fire deploy · auto-cancel in {countdown}s
              </div>
              <button
                onClick={fireDeploy}
                disabled={deploying}
                style={{ fontSize: 22, fontWeight: 700, padding: '22px 72px', borderRadius: 12, background: btnBg, border: `2px solid ${btnBorder}`, color: RED, cursor: 'pointer', letterSpacing: 2, animation: 'pulse 1s infinite' }}
              >
                {deploying ? '⏳ DISPATCHING…' : `🔥 CONFIRM DEPLOY (${countdown})`}
              </button>
              <div>
                <button
                  onClick={() => { setConfirming(false); setCountdown(5); }}
                  style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 11, marginTop: 12, textDecoration: 'underline' }}
                >
                  cancel
                </button>
              </div>
            </>
          )}

          {result && (
            <div style={{ marginTop: 20, textAlign: 'left', background: BG, border: `1px solid ${result.ok ? GREEN : RED}55`, borderRadius: 8, padding: 14, fontSize: 12 }}>
              <div style={{ color: result.ok ? GREEN : RED, fontWeight: 700, marginBottom: 6 }}>
                {result.ok ? '✅ DISPATCHED' : '❌ FAILED'}
              </div>
              <div style={{ color: TEXT, whiteSpace: 'pre-wrap' }}>{result.message || result.error}</div>
              {result.runId && (
                <div style={{ color: CYAN, marginTop: 6 }}>
                  Run ID: {result.runId} · <a href={`https://github.com/younestsouli2019-bot/Nouveau-dossier-3-/actions/runs/${result.runId}`} target="_blank" rel="noreferrer" style={{ color: CYAN }}>watch on GitHub →</a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Latest run */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, letterSpacing: 1 }}>LATEST WORKFLOW RUN</div>
          {run ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
              <span style={{ color: runColor, fontWeight: 700 }}>
                {run.status === 'completed'
                  ? run.conclusion === 'success' ? '● SUCCESS' : '● FAILURE'
                  : run.status === 'in_progress' ? '● IN PROGRESS' : `● ${run.status.toUpperCase()}`}
              </span>
              <span style={{ color: MUTED }}>#{run.id}</span>
              <span style={{ color: TEXT, flex: 1, minWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.message}</span>
              <span style={{ color: MUTED, fontSize: 11 }}>{new Date(run.createdAt).toLocaleString()}</span>
              <a href={`https://github.com/younestsouli2019-bot/Nouveau-dossier-3-/actions/runs/${run.id}`} target="_blank" rel="noreferrer" style={{ color: CYAN, fontSize: 12 }}>logs →</a>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: MUTED }}>no runs found</div>
          )}
        </div>

        {/* Targets */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14, letterSpacing: 1 }}>
            DEPLOYMENT TARGETS {state?.checkedAt ? `· checked ${new Date(state.checkedAt).toLocaleTimeString()}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(state?.targets || []).map((t) => (
              <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 12, background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, minWidth: 22 }}>
                  {t.code === 0 ? '⬜' : t.ok ? '🟢' : t.fatal ? '🔴' : '🟡'}
                </span>
                <span style={{ fontSize: 13, minWidth: 230, fontWeight: 600 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: t.ok ? GREEN : t.fatal ? RED : AMBER, minWidth: 70 }}>
                  HTTP {t.code || '—'}
                </span>
                <span style={{ fontSize: 11, color: MUTED, minWidth: 60 }}>{t.latencyMs}ms</span>
                <a href={t.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: CYAN, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.url.replace('https://', '')}
                </a>
              </div>
            ))}
            {!state && <div style={{ color: MUTED, fontSize: 12 }}>probing targets…</div>}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 14 }}>
            🟢 live · 🟡 non-fatal target down (Space-Z project recycled by platform — recreate at z.ai to restore) · 🔴 fatal target down · ⬜ unreachable
          </div>
        </div>

      </div>
      <style>{`@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,.4);} 50% { box-shadow: 0 0 0 10px rgba(255,68,68,0);} }`}</style>
    </div>
  );
}
