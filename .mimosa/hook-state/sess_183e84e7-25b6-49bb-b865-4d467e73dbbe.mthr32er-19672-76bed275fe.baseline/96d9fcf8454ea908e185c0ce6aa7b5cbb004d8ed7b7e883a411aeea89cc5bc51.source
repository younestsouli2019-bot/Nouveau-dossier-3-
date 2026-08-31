'use client';

import { useEffect, useState } from 'react';

interface WetRunExecution {
  id: string;
  executionMode: string;
  dataSource: string;
  ownerConfirmedBy: string | null;
  status: string;
  amount: number;
  currency: string;
  microMoveVerified: boolean;
  routingToken: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#ffaa00',
  RAIL_VERIFIED: '#00ccff',
  WET_RUN_PROCESSED: '#00ff88',
  LIVE_SETTLED: '#00ff88',
  FAILED: '#ff4444',
};

export default function OpsWetRun() {
  const [executions, setExecutions] = useState<WetRunExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [mode, setMode] = useState<'simulation' | 'wetRun' | 'live'>('wetRun');
  const [owner, setOwner] = useState('Younes Tsouli');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    fetch('/api/settlements/wet-run')
      .then(r => r.json())
      .then(data => { setExecutions(data.executions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleExecute = async () => {
    if (!amount || !owner) return;
    setExecuting(true);
    try {
      const res = await fetch('/api/settlements/wet-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          currency,
          executionMode: mode,
          dataSource: 'live_bank_api',
          ownerConfirmedBy: owner,
        }),
      });
      const data = await res.json();
      if (data.executionId) {
        setExecutions(prev => [{ ...data, id: data.executionId, amount: parseFloat(amount), currency, executionMode: mode, dataSource: 'live_bank_api', ownerConfirmedBy: owner, routingToken: data.routingToken, microMoveVerified: data.microMoveVerified, createdAt: new Date().toISOString() }, ...prev]);
        setAmount('');
        alert(`Execution ${data.status}: ${data.executionId}`);
      } else {
        alert(data.error || 'Execution failed');
      }
    } finally {
      setExecuting(false);
    }
  };

  const stats = {
    total: executions.length,
    wetRun: executions.filter(e => e.status === 'WET_RUN_PROCESSED').length,
    live: executions.filter(e => e.status === 'LIVE_SETTLED').length,
    failed: executions.filter(e => e.status === 'FAILED').length,
    railVerified: executions.filter(e => e.status === 'RAIL_VERIFIED').length,
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'monospace' }}>Loading...</div>;

  return (
    <div style={{ padding: 40, fontFamily: 'monospace', background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh' }}>
      <h1 style={{ color: '#ffaa00', marginBottom: 8 }}>OPERATIONS CONTROL</h1>
      <p style={{ color: '#888', marginBottom: 24 }}>Wet-Run Settlement Framework</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, flex: 1 }}>
          <div style={{ color: '#888', fontSize: 12 }}>Active Mode</div>
          <div style={{ color: '#ffaa00', fontSize: 24 }}>{mode.toUpperCase()}</div>
        </div>
        <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, flex: 1 }}>
          <div style={{ color: '#888', fontSize: 12 }}>Wet-Run Success Rate</div>
          <div style={{ color: '#00ff88', fontSize: 24 }}>{stats.total > 0 ? ((stats.wetRun + stats.live) / stats.total * 100).toFixed(1) : '0.0'}%</div>
        </div>
        <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, flex: 1 }}>
          <div style={{ color: '#888', fontSize: 12 }}>Total Executions</div>
          <div style={{ color: '#00ccff', fontSize: 24 }}>{stats.total}</div>
        </div>
        <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, flex: 1 }}>
          <div style={{ color: '#888', fontSize: 12 }}>Rail Verified</div>
          <div style={{ color: '#00ccff', fontSize: 24 }}>{stats.railVerified}</div>
        </div>
      </div>

      <div style={{ border: '1px solid #333', padding: 24, borderRadius: 8, marginBottom: 32 }}>
        <h2 style={{ color: '#00ccff', marginBottom: 16 }}>NEW SETTLEMENT EXECUTION</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ color: '#888', fontSize: 12 }}>Amount</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" step="0.01" min="0.01" placeholder="0.01" style={{ width: '100%', padding: 8, background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4 }} />
          </div>
          <div>
            <label style={{ color: '#888', fontSize: 12 }}>Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', padding: 8, background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4 }}>
              <option>USD</option>
              <option>EUR</option>
              <option>MAD</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#888', fontSize: 12 }}>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} style={{ width: '100%', padding: 8, background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4 }}>
              <option value="simulation">SIMULATION</option>
              <option value="wetRun">WET-RUN</option>
              <option value="live">LIVE</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#888', fontSize: 12 }}>Owner Confirmed By</label>
            <input value={owner} onChange={e => setOwner(e.target.value)} style={{ width: '100%', padding: 8, background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4 }} />
          </div>
          <button
            onClick={handleExecute}
            disabled={executing || !amount}
            style={{ padding: '8px 24px', background: executing ? '#666' : '#00ff88', color: '#000', border: 'none', borderRadius: 4, cursor: executing ? 'default' : 'pointer', fontWeight: 'bold', fontSize: 14 }}
          >
            {executing ? 'EXECUTING...' : 'RUN WET-TEST'}
          </button>
        </div>
      </div>

      <h2 style={{ color: '#00ccff', marginBottom: 16 }}>EXECUTION QUEUE</h2>
      {executions.length === 0 ? (
        <p style={{ color: '#888' }}>No executions yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: 12 }}>TXN ID</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Amount</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Mode</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Data Source</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Owner Verified</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Micro-Move</th>
              <th style={{ textAlign: 'left', padding: 12 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {executions.map(ex => (
              <tr key={ex.id} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: 12, color: '#00ccff' }}>{ex.id.slice(0, 12)}...</td>
                <td style={{ padding: 12 }}>{ex.amount} {ex.currency}</td>
                <td style={{ padding: 12 }}>{ex.executionMode}</td>
                <td style={{ padding: 12 }}>{ex.dataSource}</td>
                <td style={{ padding: 12 }}>{ex.ownerConfirmedBy ? '✅ ' + ex.ownerConfirmedBy : '❌ PENDING'}</td>
                <td style={{ padding: 12 }}>{ex.microMoveVerified ? '✅ Verified' : '—'}</td>
                <td style={{ padding: 12 }}>
                  <span style={{ padding: '4px 8px', borderRadius: 4, background: STATUS_COLORS[ex.status] || '#666', color: '#000', fontSize: 12 }}>
                    {ex.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
