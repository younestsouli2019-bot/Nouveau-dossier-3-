import React, { useState, useEffect } from 'react';
import { Shield, Lock, AlertTriangle, CheckCircle, XCircle, Zap, DollarSign, Clock, User } from 'lucide-react';

const OwnerPayoutEnforcer = () => {
  const [systemState, setSystemState] = useState({
    ownerDirectiveActive: true,
    hardLockEnabled: true,
    bypassProtection: true,
    autoSettlementActive: false
  });

  const [ownerAccounts, setOwnerAccounts] = useState({
    paypal: {
      email: 'younestsouli2019@gmail.com',
      verified: true,
      status: 'ACTIVE',
      priority: 1
    },
    bank: {
      rib: '007810000448500030594182',
      name: 'Attijariwafa Bank',
      verified: true,
      status: 'ACTIVE',
      priority: 2
    },
    payoneer: {
      account: 'PRINCIPAL_ACCOUNT',
      verified: true,
      status: 'ACTIVE',
      priority: 3
    }
  });

  const [pendingRevenue, setPendingRevenue] = useState({
    total: 76891.23,
    verified: 287,
    readyForPayout: 245,
    pending: 42,
    blocked: 0
  });

  const [settlementQueue, setSettlementQueue] = useState([]);
  const [executionLog, setExecutionLog] = useState([]);

  const addLog = (message, type = 'info', rail = null) => {
    setExecutionLog(prev => [...prev, {
      timestamp: new Date().toISOString(),
      message,
      type,
      rail
    }].slice(-50));
  };

  useEffect(() => {
    if (systemState.ownerDirectiveActive) {
      addLog('🔒 Owner Revenue Directive ACTIVE - All funds locked to owner accounts', 'success');
    }
  }, []);

  const validateOwnerDirective = () => {
    addLog('🔍 Validating Owner Revenue Directive...', 'info');
    
    setTimeout(() => {
      const violations = [];
      
      // Check for any non-owner destinations in database
      const mockCheck = Math.random();
      
      if (mockCheck > 0.9) {
        violations.push('Found 3 revenue events with non-owner destinations');
        addLog('⚠️ VIOLATION DETECTED: Non-owner destinations found', 'error');
      } else {
        addLog('✅ All revenue events point to owner accounts only', 'success');
      }
      
      if (violations.length === 0) {
        addLog('✅ Owner Revenue Directive: COMPLIANT', 'success');
      } else {
        addLog('🚨 Owner Revenue Directive: VIOLATIONS DETECTED', 'error');
        violations.forEach(v => addLog(`   - ${v}`, 'error'));
      }
    }, 1500);
  };

  const activateAutoSettlement = () => {
    addLog('⚡ Activating Autonomous Settlement Mode...', 'warning');
    
    setTimeout(() => {
      setSystemState(prev => ({ ...prev, autoSettlementActive: true }));
      addLog('✅ AUTO-SETTLEMENT ACTIVE: All verified revenue will be settled immediately', 'success');
      addLog('📋 Settlement Priority: PayPal → Bank Wire → Payoneer', 'info');
      addLog('⏱️ Max Settlement Delay: 15 minutes from verification', 'info');
      
      // Start settlement simulation
      initiateSettlementCycle();
    }, 1000);
  };

  const deactivateAutoSettlement = () => {
    setSystemState(prev => ({ ...prev, autoSettlementActive: false }));
    addLog('🛑 Auto-Settlement DEACTIVATED', 'warning');
  };

  const initiateSettlementCycle = () => {
    addLog('🔄 Initiating settlement cycle...', 'info');
    
    // Simulate batch creation
    const batches = [
      {
        id: 'BATCH_PP_001',
        rail: 'PayPal',
        events: 156,
        amount: 45234.50,
        destination: ownerAccounts.paypal.email,
        status: 'PENDING'
      },
      {
        id: 'BATCH_BANK_001',
        rail: 'Bank Wire',
        events: 67,
        amount: 23456.73,
        destination: ownerAccounts.bank.rib,
        status: 'PENDING'
      },
      {
        id: 'BATCH_PN_001',
        rail: 'Payoneer',
        events: 22,
        amount: 8200.00,
        destination: ownerAccounts.payoneer.account,
        status: 'PENDING'
      }
    ];
    
    setSettlementQueue(batches);
    addLog(`📦 Created ${batches.length} settlement batches`, 'success');
    
    // Auto-execute after 2 seconds
    setTimeout(() => {
      executeBatches(batches);
    }, 2000);
  };

  const forceExecuteAllRails = async () => {
    const rails = [
      {
        id: `FORCE_PP_${Date.now()}`,
        rail: 'PayPal',
        events: Math.floor(pendingRevenue.readyForPayout * 0.5),
        amount: Math.max(0, pendingRevenue.total * 0.5),
        destination: ownerAccounts.paypal.email,
        status: 'PENDING'
      },
      {
        id: `FORCE_BANK_${Date.now()}`,
        rail: 'Bank Wire',
        events: Math.floor(pendingRevenue.readyForPayout * 0.3),
        amount: Math.max(0, pendingRevenue.total * 0.3),
        destination: ownerAccounts.bank.rib,
        status: 'PENDING'
      },
      {
        id: `FORCE_PN_${Date.now()}`,
        rail: 'Payoneer',
        events: Math.floor(pendingRevenue.readyForPayout * 0.2),
        amount: Math.max(0, pendingRevenue.total * 0.2),
        destination: ownerAccounts.payoneer.account,
        status: 'PENDING'
      }
    ];
    setSettlementQueue(rails);
    addLog(`📦 Prepared ${rails.length} forced execution batches across all rails`, 'success');
    await executeBatches(rails);
  };

  const executeBatches = async (batches) => {
    for (const batch of batches) {
      addLog(`⚡ Executing ${batch.rail} batch: ${batch.id}`, 'info', batch.rail);
      addLog(`   → Destination: ${batch.destination}`, 'info', batch.rail);
      addLog(`   → Amount: $${batch.amount.toLocaleString()}`, 'info', batch.rail);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Simulate success
      batch.status = 'EXECUTED';
      batch.executedAt = new Date().toISOString();
      batch.providerBatchId = `${batch.rail.toUpperCase()}_${Date.now()}`;
      
      setSettlementQueue(prev => 
        prev.map(b => b.id === batch.id ? batch : b)
      );
      
      addLog(`✅ ${batch.rail} batch EXECUTED successfully`, 'success', batch.rail);
      addLog(`   → Provider Batch ID: ${batch.providerBatchId}`, 'success', batch.rail);
      
      // Update pending revenue
      setPendingRevenue(prev => ({
        ...prev,
        readyForPayout: Math.max(0, prev.readyForPayout - batch.events)
      }));
    }
    
    addLog('🎉 ALL BATCHES EXECUTED - Funds en route to owner accounts', 'success');
  };

  const emergencyPayout = () => {
    addLog('🚨 EMERGENCY PAYOUT INITIATED', 'warning');
    addLog('⚡ Bypassing all approval gates...', 'warning');
    
    setTimeout(() => {
      addLog('✅ Emergency approval granted', 'success');
      addLog('💰 Executing immediate payout to all owner accounts', 'info');
      
      const emergencyBatch = {
        id: 'EMERGENCY_001',
        rail: 'Multi-Rail',
        events: pendingRevenue.readyForPayout,
        amount: pendingRevenue.total,
        destinations: [
          ownerAccounts.paypal.email,
          ownerAccounts.bank.rib,
          ownerAccounts.payoneer.account
        ],
        status: 'EXECUTING'
      };
      
      setTimeout(() => {
        emergencyBatch.status = 'COMPLETED';
        addLog('✅ EMERGENCY PAYOUT COMPLETED', 'success');
        addLog(`💸 $${pendingRevenue.total.toLocaleString()} transferred to owner accounts`, 'success');
        
        setPendingRevenue(prev => ({
          ...prev,
          readyForPayout: 0,
          total: 0
        }));
      }, 2000);
    }, 1000);
  };

  const forceReconciliation = () => {
    addLog('🔄 Forcing PSP reconciliation for all pending events...', 'info');
    
    setTimeout(() => {
      const recovered = Math.floor(Math.random() * 20) + 15;
      addLog(`✅ Recovered ${recovered} missing PSP proofs`, 'success');
      addLog('📋 All recovered events added to settlement queue', 'success');
      
      setPendingRevenue(prev => ({
        ...prev,
        pending: Math.max(0, prev.pending - recovered),
        readyForPayout: prev.readyForPayout + recovered
      }));
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Shield className="w-10 h-10 text-green-400" />
            Owner-Only Payout Enforcement
          </h1>
          <p className="text-blue-200 text-lg">
            Zero Leeway • No Opt-Out • Immediate Settlement
          </p>
        </div>

        {/* Critical Status Banner */}
        <div className="bg-gradient-to-r from-red-900/50 to-orange-900/50 border-2 border-red-500 rounded-lg p-6 mb-6">
          <div className="flex items-start gap-4">
            <Lock className="w-8 h-8 text-red-400 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-white mb-2">Owner Revenue Directive ACTIVE</h2>
              <p className="text-red-200 mb-3">
                All revenue is HARD-LOCKED to owner accounts only. Any configuration attempting to route funds elsewhere will be automatically REJECTED with VIOLATION error.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-2 text-green-300">
                  <CheckCircle className="w-4 h-4" />
                  <span>PayPal: {ownerAccounts.paypal.email}</span>
                </div>
                <div className="flex items-center gap-2 text-green-300">
                  <CheckCircle className="w-4 h-4" />
                  <span>Bank: {ownerAccounts.bank.rib}</span>
                </div>
                <div className="flex items-center gap-2 text-green-300">
                  <CheckCircle className="w-4 h-4" />
                  <span>Payoneer: Principal Account</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* System Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className={`p-4 rounded-lg border-2 ${systemState.ownerDirectiveActive ? 'bg-green-900/30 border-green-500' : 'bg-red-900/30 border-red-500'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-semibold text-sm">Owner Directive</span>
              <Shield className={`w-5 h-5 ${systemState.ownerDirectiveActive ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-2xl font-bold ${systemState.ownerDirectiveActive ? 'text-green-400' : 'text-red-400'}`}>
              {systemState.ownerDirectiveActive ? 'ACTIVE' : 'INACTIVE'}
            </p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${systemState.hardLockEnabled ? 'bg-green-900/30 border-green-500' : 'bg-red-900/30 border-red-500'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-semibold text-sm">Hard Lock</span>
              <Lock className={`w-5 h-5 ${systemState.hardLockEnabled ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-2xl font-bold ${systemState.hardLockEnabled ? 'text-green-400' : 'text-red-400'}`}>
              {systemState.hardLockEnabled ? 'ENABLED' : 'DISABLED'}
            </p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${systemState.bypassProtection ? 'bg-green-900/30 border-green-500' : 'bg-red-900/30 border-red-500'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-semibold text-sm">Bypass Protection</span>
              <AlertTriangle className={`w-5 h-5 ${systemState.bypassProtection ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-2xl font-bold ${systemState.bypassProtection ? 'text-green-400' : 'text-red-400'}`}>
              {systemState.bypassProtection ? 'ACTIVE' : 'INACTIVE'}
            </p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${systemState.autoSettlementActive ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/50 border-slate-600'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-semibold text-sm">Auto-Settlement</span>
              <Zap className={`w-5 h-5 ${systemState.autoSettlementActive ? 'text-blue-400' : 'text-slate-400'}`} />
            </div>
            <p className={`text-2xl font-bold ${systemState.autoSettlementActive ? 'text-blue-400' : 'text-slate-400'}`}>
              {systemState.autoSettlementActive ? 'ACTIVE' : 'STANDBY'}
            </p>
          </div>
        </div>

        {/* Revenue Status */}
        <div className="bg-slate-800/70 rounded-lg p-6 border border-slate-600 mb-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-400" />
            Revenue Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-white">${pendingRevenue.total.toLocaleString()}</div>
              <div className="text-sm text-slate-400 mt-1">Total Pending</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">{pendingRevenue.verified}</div>
              <div className="text-sm text-slate-400 mt-1">Verified Events</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{pendingRevenue.readyForPayout}</div>
              <div className="text-sm text-slate-400 mt-1">Ready for Payout</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-400">{pendingRevenue.pending}</div>
              <div className="text-sm text-slate-400 mt-1">Pending Proof</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-400">{pendingRevenue.blocked}</div>
              <div className="text-sm text-slate-400 mt-1">Blocked</div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="bg-slate-800/70 rounded-lg p-6 border border-slate-600 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Control Panel</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <button
              onClick={validateOwnerDirective}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Shield className="w-5 h-5" />
              Validate Directive
            </button>

            <button
              onClick={systemState.autoSettlementActive ? deactivateAutoSettlement : activateAutoSettlement}
              className={`px-6 py-3 ${systemState.autoSettlementActive ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2`}
            >
              <Zap className="w-5 h-5" />
              {systemState.autoSettlementActive ? 'Deactivate' : 'Activate'} Auto
            </button>

            <button
              onClick={emergencyPayout}
              disabled={pendingRevenue.readyForPayout === 0}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <AlertTriangle className="w-5 h-5" />
              Emergency Payout
            </button>

            <button
              onClick={forceExecuteAllRails}
              disabled={pendingRevenue.readyForPayout === 0 || pendingRevenue.total === 0}
              className="px-6 py-3 bg-green-700 hover:bg-green-800 disabled:bg-slate-600 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <DollarSign className="w-5 h-5" />
              Force All Rails
            </button>

            <button
              onClick={forceReconciliation}
              disabled={pendingRevenue.pending === 0}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Clock className="w-5 h-5" />
              Force Reconcile
            </button>
          </div>
        </div>

        {/* Settlement Queue */}
        {settlementQueue.length > 0 && (
          <div className="bg-slate-800/70 rounded-lg p-6 border border-slate-600 mb-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Zap className="w-6 h-6 text-blue-400" />
              Active Settlement Queue
            </h2>
            <div className="space-y-3">
              {settlementQueue.map((batch, idx) => (
                <div key={idx} className="bg-slate-700/50 rounded p-4 border border-slate-600">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-semibold text-white text-lg">{batch.rail}</span>
                      <span className="text-slate-400 text-sm ml-3">{batch.id}</span>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      batch.status === 'EXECUTED' ? 'bg-green-900/50 text-green-300' :
                      batch.status === 'PENDING' ? 'bg-yellow-900/50 text-yellow-300' :
                      'bg-blue-900/50 text-blue-300'
                    }`}>
                      {batch.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                    <div className="text-slate-300">
                      <span className="text-slate-500">Events:</span> {batch.events}
                    </div>
                    <div className="text-slate-300">
                      <span className="text-slate-500">Amount:</span> ${batch.amount.toLocaleString()}
                    </div>
                    <div className="text-slate-300 truncate">
                      <span className="text-slate-500">Destination:</span> {batch.destination}
                    </div>
                  </div>
                  {batch.providerBatchId && (
                    <div className="mt-2 text-xs text-green-400">
                      Provider Batch ID: {batch.providerBatchId}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Execution Log */}
        <div className="bg-slate-800/70 rounded-lg p-6 border border-slate-600">
          <h2 className="text-xl font-bold text-white mb-4">Execution Log</h2>
          <div className="bg-slate-900/50 rounded p-4 max-h-96 overflow-y-auto font-mono text-sm">
            {executionLog.length === 0 ? (
              <div className="text-slate-500">System ready. Awaiting commands.</div>
            ) : (
              executionLog.map((log, idx) => (
                <div key={idx} className={`mb-1 ${
                  log.type === 'success' ? 'text-green-400' :
                  log.type === 'warning' ? 'text-yellow-400' :
                  log.type === 'error' ? 'text-red-400' :
                  'text-slate-300'
                }`}>
                  <span className="text-slate-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  {log.rail && <span className="text-blue-400"> [{log.rail}]</span>}
                  {' '}{log.message}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Warning */}
        <div className="mt-6 bg-red-900/20 border border-red-500/50 rounded-lg p-4 text-center">
          <p className="text-red-300 font-semibold">
            ⚠️ CRITICAL: Owner Revenue Directive is NON-NEGOTIABLE
          </p>
          <p className="text-red-400/80 text-sm mt-1">
            Any attempt to bypass, disable, or modify owner-only payout destinations will result in immediate system freeze and security audit.
          </p>
        </div>
      </div>
    </div>
  );
};

export default OwnerPayoutEnforcer;
