import { getCredentialStatus } from '@/lib/connector-credentials';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONNECTOR_DETAILS: Record<string, { name: string; description: string }> = {
  attijariwafa: {
    name: 'Attijariwafa Bank',
    description: 'PSD2 banking integration',
  },
  paypal: {
    name: 'PayPal',
    description: 'Payment processor',
  },
  banking_circle: {
    name: 'Banking Circle',
    description: 'Bank wire transfers',
  },
  base44: {
    name: 'Base44',
    description: 'Agent platform',
  },
  payoneer: {
    name: 'Payoneer',
    description: 'Payment processor',
  },
  binance: {
    name: 'Binance',
    description: 'Crypto exchange',
  },
  bybit: {
    name: 'Bybit',
    description: 'Crypto exchange',
  },
  bitget: {
    name: 'Bitget',
    description: 'Crypto exchange',
  },
  wise: {
    name: 'Wise',
    description: 'International transfers',
  },
  stripe: {
    name: 'Stripe',
    description: 'Payment processor',
  },
  tron: {
    name: 'Tron (TRC20)',
    description: 'Crypto payment rail',
  },
  googlepay: {
    name: 'Google Pay',
    description: 'Digital wallet',
  },
};

const STATUS_STYLES: Record<string, string> = {
  live: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  test: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  offline: 'border-slate-700 bg-slate-900/60 text-slate-400',
};

export default function PaymentConnectorsPage() {
  const connectors = getCredentialStatus();
  const entries = Object.entries(connectors).filter(([id]) => CONNECTOR_DETAILS[id]);
  const configuredCount = entries.filter(([, connector]) => connector.active).length;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-400">
              Runtime configuration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Payment Connectors</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Readiness is determined by credentials available to this app&apos;s server runtime.
              Secret values are never sent to or displayed in the browser.
            </p>
          </div>
          <a
            href="/payment-connectors"
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300"
          >
            Refresh status
          </a>
        </header>

        <section aria-label="Connector summary" className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Connectors listed</p>
            <p className="mt-2 text-3xl font-semibold">{entries.length}</p>
          </div>
          <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/30 p-5">
            <p className="text-sm text-emerald-300/80">Configured in runtime</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-300">{configuredCount}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Offline</p>
            <p className="mt-2 text-3xl font-semibold">{entries.length - configuredCount}</p>
          </div>
        </section>

        <section aria-labelledby="connectors-heading">
          <div className="mb-4">
            <h2 id="connectors-heading" className="text-lg font-semibold">Connector status</h2>
            <p className="mt-1 text-sm text-slate-400">
              Status reflects server-side environment configuration; it does not claim that a provider
              connection was tested or that payouts are enabled.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map(([id, connector]) => {
              const details = CONNECTOR_DETAILS[id];
              const mode = connector.mode.toLowerCase();
              const style = STATUS_STYLES[mode] ?? STATUS_STYLES.offline;

              return (
                <article key={id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-slate-100">{details.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">{details.description}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium uppercase ${style}`}>
                      {mode}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-3 text-xs">
                    <span className="text-slate-500">Connector ID</span>
                    <code className="text-slate-300">{id}</code>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Configuration</span>
                    <span className={connector.active ? 'text-emerald-300' : 'text-slate-400'}>
                      {connector.active ? 'Credentials present' : 'Credentials not detected'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <p className="text-xs text-slate-500">
          To change these statuses, provision the corresponding secrets in the hosting runtime and redeploy.
          GitHub repository secrets are not automatically available to a running preview unless a configured,
          authenticated deployment or synchronization workflow provisions them there.
        </p>
      </div>
    </main>
  );
}
