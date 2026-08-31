'use client';

import { useEffect, useState } from 'react';

interface SLAStatus {
  poId: string;
  poNumber: string;
  supplierName: string;
  ackStatus: string;
  slaHours: number;
  slaDeadline: string | null;
  slaBreached: boolean;
  acknowledgedAt: string | null;
  hoursRemaining: number | null;
}

interface Scorecard {
  supplierId: string | null;
  supplierName: string;
  totalPOs: number;
  acknowledged: number;
  slaBreached: number;
  onTimeRate: number;
  avgResponseHours: number;
  activeBreaches: number;
}

export default function SupplierPortal() {
  const [active, setActive] = useState<SLAStatus[]>([]);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sla/status')
      .then(r => r.json())
      .then(data => {
        setActive(data.active || []);
        setScorecards(data.scorecards || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleAck = async (poId: string) => {
    const name = prompt('Enter your supplier name or ID:');
    if (!name) return;
    const res = await fetch(`/api/purchase-orders/${poId}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedBy: name }),
    });
    if (res.ok) {
      setActive(prev => prev.filter(p => p.poId !== poId));
      alert('PO acknowledged successfully');
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to acknowledge');
    }
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'monospace' }}>Loading supplier portal...</div>;

  return (
    <div style={{ padding: 40, fontFamily: 'monospace', background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh' }}>
      <h1 style={{ color: '#00ff88', marginBottom: 8 }}>SUPPLIER PORTAL</h1>
      <p style={{ color: '#888', marginBottom: 32 }}>Performance & Acknowledgement Dashboard</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
        {scorecards.map(sc => (
          <div key={sc.supplierName} style={{ border: '1px solid #333', padding: 20, borderRadius: 8 }}>
            <h3 style={{ color: '#00ccff', marginBottom: 12 }}>{sc.supplierName}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 14 }}>
              <div>On-Time ACK Rate</div>
              <div style={{ color: sc.onTimeRate >= 95 ? '#00ff88' : '#ff4444' }}>{sc.onTimeRate.toFixed(1)}%</div>
              <div>Avg Response Time</div>
              <div>{sc.avgResponseHours.toFixed(1)}h</div>
              <div>Active SLA Breaches</div>
              <div style={{ color: sc.activeBreaches > 0 ? '#ff4444' : '#00ff88' }}>{sc.activeBreaches}</div>
              <div>Total POs</div>
              <div>{sc.totalPOs}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ color: '#ffaa00', marginBottom: 16 }}>ACTIONABLE PURCHASE ORDERS</h2>
      {active.length === 0 ? (
        <p style={{ color: '#888' }}>No pending acknowledgements. All clear.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: 12 }}>PO ID</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Supplier</th>
              <th style={{ textAlign: 'left', padding: 12 }}>SLA Remaining</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {active.map(po => (
              <tr key={po.poId} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: 12, color: '#00ccff' }}>{po.poNumber}</td>
                <td style={{ padding: 12 }}>{po.slaBreached ? `⚠️ ${po.supplierName}` : po.supplierName}</td>
                <td style={{ padding: 12, color: po.slaBreached ? '#ff4444' : po.hoursRemaining !== null && po.hoursRemaining < 6 ? '#ffaa00' : '#00ff88' }}>
                  {po.slaBreached ? 'BREACHED' : po.hoursRemaining !== null ? `${po.hoursRemaining.toFixed(1)}h remaining` : 'N/A'}
                </td>
                <td style={{ padding: 12 }}>
                  <span style={{ padding: '4px 8px', borderRadius: 4, background: po.slaBreached ? '#ff4444' : '#ffaa00', color: '#000', fontSize: 12 }}>
                    {po.ackStatus}
                  </span>
                </td>
                <td style={{ padding: 12 }}>
                  <button
                    onClick={() => handleAck(po.poId)}
                    style={{ padding: '6px 16px', background: '#00ff88', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    ACKNOWLEDGE PO
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
