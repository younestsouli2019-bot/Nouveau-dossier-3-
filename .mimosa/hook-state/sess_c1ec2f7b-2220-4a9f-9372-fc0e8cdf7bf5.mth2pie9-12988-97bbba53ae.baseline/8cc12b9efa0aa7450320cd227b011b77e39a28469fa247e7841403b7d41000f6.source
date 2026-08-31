'use client';

import { useEffect, useState } from 'react';

interface ConnectorStatus {
  mode: string;
  active: boolean;
  type: string;
}

interface BalanceSummary {
  accounts: Array<{
    accountId: string;
    iban: string;
    currency: string;
    name: string;
    balances: Array<{
      balanceType: string;
      balanceAmount: { amount: string; currency: string };
      creditDebitIndicator: string;
    }>;
  }>;
  totalMAD: number;
  totalEUR: number;
  totalUSD: number;
  consentStatus: string;
  lastSyncAt: string;
  isLive: boolean;
}

interface SettlementInfo {
  module: string;
  ownerAccount: { iban: string; swift: string; name: string };
  paymentRails: string[];
  psd2Integration: boolean;
}

export default function ExchangesView() {
  const [connectors, setConnectors] = useState<Record<string, ConnectorStatus>>({});
  const [balances, setBalances] = useState<BalanceSummary | null>(null);
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [credResp, balResp, settResp] = await Promise.allSettled([
          fetch('/api/exchanges?action=status'),
          fetch('/api/exchanges?action=bank-balances'),
          fetch('/api/settlements/settle-and-payout'),
        ]);
        if (credResp.status === 'fulfilled') {
          const d = await credResp.value.json();
          setConnectors(d.connectors || {});
        }
        if (balResp.status === 'fulfilled') {
          const d = await balResp.value.json();
          setBalances(d);
        }
        if (settResp.status === 'fulfilled') {
          const d = await settResp.value.json();
          setSettlement(d);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="p-4 text-gray-400">Loading exchanges...</div>;

  const connectorOrder = ['attijariwafa', 'banking_circle', 'paypal', 'base44'];

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-bold">Exchanges & Settlements</h1>

      <section>
        <h2 className="text-lg font-semibold mb-3">Connector Status</h2>
        <div className="grid grid-cols-5 gap-3">
          {connectorOrder.map(key => {
            const c = connectors[key];
            const isGreen = c?.active;
            return (
              <div key={key} className={`p-3 rounded border ${isGreen ? 'border-green-600 bg-green-900/20' : 'border-gray-700 bg-gray-900/20'}`}>
                <div className="text-xs text-gray-400">{key.replace('_', ' ')}</div>
                <div className={`text-sm font-medium ${isGreen ? 'text-green-400' : 'text-gray-500'}`}>
                  {c?.mode?.toUpperCase() || 'OFFLINE'}
                </div>
                <div className="text-xs text-gray-500">{c?.type || '—'}</div>
              </div>
            );
          })}
          <div className={`p-3 rounded border ${balances?.isLive ? 'border-green-600 bg-green-900/20' : 'border-yellow-700 bg-yellow-900/20'}`}>
            <div className="text-xs text-gray-400">Bank (PSD2)</div>
            <div className={`text-sm font-medium ${balances?.isLive ? 'text-green-400' : 'text-yellow-400'}`}>
              {balances?.isLive ? 'LIVE' : 'NO API KEY'}
            </div>
            <div className="text-xs text-gray-500">AIS PIS</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Bank Balances</h2>
        {balances && balances.accounts && balances.accounts.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div className="p-3 rounded border border-gray-700 bg-gray-900/30">
                <div className="text-xs text-gray-400">MAD</div>
                <div className="text-lg font-mono">{balances.totalMAD.toLocaleString()} MAD</div>
              </div>
              <div className="p-3 rounded border border-gray-700 bg-gray-900/30">
                <div className="text-xs text-gray-400">EUR</div>
                <div className="text-lg font-mono">{balances.totalEUR.toLocaleString()} EUR</div>
              </div>
              <div className="p-3 rounded border border-gray-700 bg-gray-900/30">
                <div className="text-xs text-gray-400">USD</div>
                <div className="text-lg font-mono">{balances.totalUSD.toLocaleString()} USD</div>
              </div>
            </div>
            {balances.accounts.map(acct => (
              <div key={acct.accountId} className="p-3 rounded border border-gray-700">
                <div className="text-sm">{acct.name || acct.iban}</div>
                <div className="text-xs text-gray-400">{acct.iban} | {acct.currency}</div>
                {acct.balances.map((bal, i) => (
                  <div key={i} className="text-xs mt-1">
                    {bal.creditDebitIndicator}: {bal.balanceAmount.amount} {bal.balanceAmount.currency} ({bal.balanceType})
                  </div>
                ))}
              </div>
            ))}
            <div className="text-xs text-gray-500">Last sync: {balances.lastSyncAt}</div>
          </div>
        ) : (
          <div className="p-4 rounded border border-gray-700 text-gray-500">
            {balances?.isLive ? 'No accounts found' : 'Set LIVE_BANK_API secret to enable PSD2'}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Settlement Routing</h2>
        {settlement ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded border border-gray-700">
              <div className="text-xs text-gray-400">Owner Account</div>
              <div className="text-sm">{settlement.ownerAccount.name}</div>
              <div className="text-xs text-gray-400">{settlement.ownerAccount.iban} | {settlement.ownerAccount.swift}</div>
            </div>
            <div className="p-3 rounded border border-gray-700">
              <div className="text-xs text-gray-400">Payment Rails</div>
              <div className="flex gap-2 mt-1">
                {settlement.paymentRails.map(rail => (
                  <span key={rail} className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-400">{rail}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded border border-gray-700 text-gray-500">Loading...</div>
        )}
      </section>
    </div>
  );
}
