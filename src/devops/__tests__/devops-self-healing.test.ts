import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeWorkflow, fixWorkflow, parentConcurrencyGroup } from '../workflow-sanitize';
import {
  advanceBreaker, alertEmergencyChannel, repairWorkflowFile, scanDeadlocks,
} from '../deadlock-heal';

// ---------------------------------------------------------------------------
// Static engine — pattern fixtures
// ---------------------------------------------------------------------------

const DANGEROUS = `
name: Demo
on: { workflow_dispatch: {} }
concurrency:
  group: shared-pipeline
  cancel-in-progress: false
jobs:
  good-job:
    concurrency:
      group: distinct-group
      cancel-in-progress: false
    runs-on: ubuntu-latest
    steps: [{ run: echo hi }]
  deadlocked-job:
    concurrency:
      group: shared-pipeline
      cancel-in-progress: false
    runs-on: ubuntu-latest
    steps: [{ run: echo hi }]
`;

const FLOW_STYLE = `
name: Demo2
concurrency: { group: shared-pipeline }
jobs:
  j:
    concurrency: { group: shared-pipeline }
    runs-on: ubuntu-latest
    steps: [{ run: echo hi }]
`;

const HEALTHY = `
name: Demo3
concurrency:
  group: shared-pipeline
jobs:
  only-job:
    runs-on: ubuntu-latest
    steps: [{ run: echo hi }]
`;

describe('static engine — pre-flight workflow sanitization', () => {
  it('detects a child concurrency group duplicating the parent (multiline)', () => {
    const off = analyzeWorkflow('wf.yml', DANGEROUS);
    expect(off).toHaveLength(1);
    expect(off[0].job).toBe('deadlocked-job');
    expect(off[0].parentGroup).toBe('shared-pipeline');
    expect(off[0].childGroup).toBe('shared-pipeline');
  });

  it('detects flow-style duplication', () => {
    const off = analyzeWorkflow('wf2.yml', FLOW_STYLE);
    expect(off).toHaveLength(1);
    expect(off[0].job).toBe('j');
  });

  it('leaves healthy workflows untouched', () => {
    expect(analyzeWorkflow('wf3.yml', HEALTHY)).toHaveLength(0);
    expect(parentConcurrencyGroup(HEALTHY)).toBe('shared-pipeline');
    expect(parentConcurrencyGroup('name: x\njobs: {}')).toBeNull();
  });

  it('repair removes ONLY the duplicate block — healthy sibling groups survive', () => {
    const r = fixWorkflow(DANGEROUS);
    expect(r.fixed).toHaveLength(1);
    expect(r.text).toContain('group: distinct-group'); // good-job untouched
    expect(r.text).not.toContain('group: shared-pipeline\n      cancel-in-progress');
    expect(r.text).toContain('cancel-in-progress: false\njobs:'); // parent block intact
    // re-analysis of the repaired text is clean
    expect(analyzeWorkflow('wf.yml', r.text)).toHaveLength(0);
  });

  it('flags the LIVE autonomous-scheduler deadlock hazard (the real repo file)', () => {
    const p = join(process.cwd(), '.github/workflows/autonomous-scheduler.yml');
    const text = readFileSync(p, 'utf8');
    const off = analyzeWorkflow(p, text);
    expect(off.length).toBeGreaterThanOrEqual(1);
    expect(off.map((o) => o.job)).toContain('autonomous-tick');
    expect(off[0].parentGroup).toBe('autonomous-scheduler');
  });

  it('repairWorkflowFile is a no-op on clean files and idempotent on dirty ones', () => {
    const a = repairWorkflowFile('wf.yml', HEALTHY);
    expect(a.changed).toBe(false);
    const b = repairWorkflowFile('wf.yml', DANGEROUS);
    expect(b.changed).toBe(true);
    const c = repairWorkflowFile('wf.yml', b.text);
    expect(c.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dynamic engine — control-plane signature
// ---------------------------------------------------------------------------

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEADLOCK_RUN = {
  id: 9001, name: 'Autonomous Scheduler', path: '.github/workflows/autonomous-scheduler.yml',
  created_at: '2026-09-07T10:00:00Z', completed_at: '2026-09-07T10:00:00Z', // delta = 0s
};
const HEALTHY_RUN = {
  id: 9002, name: 'Autonomous Scheduler', path: '.github/workflows/autonomous-scheduler.yml',
  created_at: '2026-09-07T10:10:00Z', completed_at: '2026-09-07T10:11:23Z', // 83s
};

function makeApi(routes: (url: string) => Response | null) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    const r = routes(url);
    if (r) return r;
    return new Response('not found', { status: 404 });
  };
  return { impl, calls };
}

describe('dynamic engine — logless deadlock scraping', () => {
  it('matches the full signature: null runner, delta<=0, 0 steps, logs 404', async () => {
    const { impl } = makeApi((url) => {
      if (url.includes('/actions/runs?')) {
        return jsonResponse({ workflow_runs: [DEADLOCK_RUN, HEALTHY_RUN] });
      }
      if (url.includes(`/runs/${DEADLOCK_RUN.id}/jobs`)) {
        return jsonResponse({ jobs: [{ id: 111, runner_id: null, steps: [] }] });
      }
      if (url.includes(`/runs/${HEALTHY_RUN.id}/jobs`)) {
        return jsonResponse({ jobs: [{ id: 222, runner_id: 10342, steps: [{ name: 'x' }] }] });
      }
      return null; // logs → 404 for all
    });
    const verdicts = await scanDeadlocks({ repo: 'o/r', token: 't', fetchImpl: impl });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].runId).toBe(9001);
    expect(verdicts[0].reason).toContain('logless deadlock');
  });

  it('rejects a candidate when logs are streamable (200)', async () => {
    const { impl } = makeApi((url) => {
      if (url.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [DEADLOCK_RUN] });
      if (url.includes(`/runs/${DEADLOCK_RUN.id}/jobs`)) {
        return jsonResponse({ jobs: [{ id: 111, runner_id: null, steps: [] }] });
      }
      if (url.includes('/actions/jobs/111/logs')) {
        return new Response('log stream', { status: 200 });
      }
      return null;
    });
    const verdicts = await scanDeadlocks({ repo: 'o/r', token: 't', fetchImpl: impl });
    expect(verdicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe('circuit breaker — engine-level malfunction alerting', () => {
  it('trips after more than 3 sequential triggers and resets on a healthy scan', () => {
    let s = advanceBreaker({ consecutiveTriggers: 0, lastTriggerAt: null, tripped: false }, true).state;
    s = advanceBreaker(s, true).state;
    s = advanceBreaker(s, true).state;
    expect(s.tripped).toBe(false);
    const r = advanceBreaker(s, true); // 4th consecutive
    expect(r.state.consecutiveTriggers).toBe(4);
    expect(r.state.tripped).toBe(true);
    expect(r.trippedNow).toBe(true);

    const reset = advanceBreaker(r.state, false);
    expect(reset.state.consecutiveTriggers).toBe(0);
    expect(reset.state.tripped).toBe(false);
  });

  it('delivers the emergency-channel webhook with the malfunction payload', async () => {
    const bodies: string[] = [];
    const impl: typeof fetch = async (_u, init) => {
      bodies.push(String(init?.body));
      return new Response('{}', { status: 200 });
    };
    const ok = await alertEmergencyChannel('https://hooks.example/x', {
      repo: 'o/r',
      consecutiveTriggers: 4,
      lastRuns: [],
    }, impl);
    expect(ok).toBe(true);
    expect(bodies[0]).toContain('CIRCUIT BREAKER TRIPPED');
    expect(bodies[0]).toContain('o/r');
  });
});
