const BG = '#0a0e14';
const PANEL = '#11161f';
const BORDER = '#1e2836';
const TEXT = '#c5d1de';
const MUTED = '#7b8da1';
const GREEN = '#00ff88';
const CYAN = '#00ccff';
const AMBER = '#ffaa00';

const workflowUrl =
  'https://github.com/younestsouli2019-bot/Nouveau-dossier-3-/actions/workflows/devops-self-healing.yml';

export default function SelfHealingPage() {
  return (
    <main
      style={{
        background: BG,
        minHeight: '100vh',
        color: TEXT,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '32px 16px',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0, letterSpacing: 1 }}>
            F-SHAP · SELF-HEALING CONTROL
          </h1>
          <p style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>
            Workflow failure triage and guarded concurrency repair
          </p>
        </header>

        <section
          aria-labelledby="status-heading"
          style={{
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <h2 id="status-heading" style={{ fontSize: 14, color: GREEN, marginTop: 0 }}>
            SCHEDULED SCANS · DRY RUN
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
            The self-healing workflow scans recent failed GitHub Actions runs and
            checks workflow concurrency rules. Scheduled runs only report
            findings; they do not push repairs.
          </p>
        </section>

        <section
          aria-labelledby="safety-heading"
          style={{
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h2 id="safety-heading" style={{ fontSize: 14, color: AMBER, marginTop: 0 }}>
            REPAIR SAFEGUARDS
          </h2>
          <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20, marginBottom: 0 }}>
            <li>Live repair is available only through an operator-dispatched workflow run.</li>
            <li>Repairs are limited to removing duplicate workflow concurrency lines.</li>
            <li>The self-healing workflow itself is protected and requires owner approval.</li>
            <li>A repair token is required to push changes; without it, no repair is pushed.</li>
          </ul>
        </section>

        <a
          href={workflowUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            background: '#0d3b2e',
            border: `1px solid ${GREEN}`,
            borderRadius: 6,
            color: CYAN,
            fontSize: 13,
            padding: '12px 16px',
            textDecoration: 'none',
          }}
        >
          Open self-healing workflow runs →
        </a>
        <p style={{ color: MUTED, fontSize: 11, lineHeight: 1.6 }}>
          Review the scan results in GitHub Actions. Scheduled runs are dry-run;
          choose the workflow-dispatch options there if an authorized live repair
          is explicitly intended.
        </p>
      </div>
    </main>
  );
}
