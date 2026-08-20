// POST /api/swarm/orchestrate
// Central orchestrator endpoint — runs the full agentic e-commerce loop
import { NextRequest, NextResponse } from 'next/server';
import { scanMarketplace, getSuppliers, getCategoryRisk } from '@/lib/swarm/market-scout';
import { createProfile, getProfiles, advanceWarmingPhase } from '@/lib/swarm/browser-swarm';
import { createAccount, getAccounts, checkWarmingProgress } from '@/lib/swarm/account-management';
import { createVirtualCard, fundCard, getCards } from '@/lib/swarm/payment-infrastructure';
import { getBalances, getProfitability, getGuardrails } from '@/lib/swarm/financial-ledger';
import { publish, getEventLog, getSubscriberCount, wireSwarmReactions } from '@/lib/swarm/event-bus';
import { getCircuitState, getPendingMfaRequests, configureCircuitBreaker } from '@/lib/swarm/security-guardrails';

// Wire standard cross-module reactions on first request
let reactionsWired = false;
if (!reactionsWired) {
  wireSwarmReactions();
  reactionsWired = true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'scan': {
        const result = await scanMarketplace({
          keywords: body.keywords || ['wireless earbuds', 'phone case', 'laptop stand'],
          categories: body.categories || ['electronics', 'accessories'],
          minMarginPct: body.minMarginPct || 30,
          maxRiskScore: body.maxRiskScore || 50,
          maxSupplierRating: body.maxSupplierRating || 4.3,
          minDemandScore: body.minDemandScore || 40,
          maxPrice: body.maxPrice || 100,
          currency: body.currency || 'USD',
          limit: body.limit || 20,
        });
        for (const opp of result.opportunities.slice(0, 5)) {
          await publish({ type: 'opportunity.discovered', payload: { opportunityId: opp.id, name: opp.name, score: opp.overallScore } });
        }
        return NextResponse.json(result);
      }

      case 'provision_account': {
        const profile = createProfile(
          body.profileName || `agent-${Date.now()}`,
          body.proxyHost || '127.0.0.1',
          body.proxyPort || 1080,
        );
        const account = await createAccount({
          platform: body.platform || 'amazon',
          mfaMethod: body.mfaMethod || 'email',
          proxy: `${profile.proxy.host}:${profile.proxy.port}`,
          fingerprint: profile.id,
        });
        await publish({ type: 'account.provisioned', payload: { accountId: account.id, platform: account.platform } });
        return NextResponse.json({ profile, account });
      }

      case 'create_card': {
        const card = await createVirtualCard({
          accountId: body.accountId,
          profileId: body.profileId,
          spendingLimit: body.spendingLimit || 500,
          dailyLimit: body.dailyLimit || 200,
          billingAddress: body.billingAddress || {
            name: 'Agent User', street: '123 Main St', city: 'New York',
            state: 'NY', zip: '10001', country: 'US', phone: '+12125551234',
          },
          currency: body.currency || 'USD',
        });
        await publish({ type: 'card.created', payload: { cardId: card.id, last4: card.last4, spendingLimit: card.spendingLimit } });
        return NextResponse.json(card);
      }

      case 'status': {
        return NextResponse.json({
          profiles: getProfiles().length,
          accounts: getAccounts().length,
          cards: getCards().length,
          balances: getBalances(),
          profitability: getProfitability(),
          circuit: getCircuitState(),
          pendingMfa: getPendingMfaRequests().length,
          recentEvents: getEventLog(10),
          subscribers: getSubscriberCount(),
        });
      }

      case 'configure_circuit': {
        configureCircuitBreaker({
          maxHourlySpend: body.maxHourlySpend,
          maxDailySpend: body.maxDailySpend,
          maxSingleTransaction: body.maxSingleTransaction,
          allowedDestinations: body.allowedDestinations,
          blockedDestinations: body.blockedDestinations,
        });
        return NextResponse.json({ configured: true, circuit: getCircuitState() });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}. Use: scan, provision_account, create_card, status, configure_circuit` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    module: 'Swarm Orchestrator',
    actions: ['scan', 'provision_account', 'create_card', 'status', 'configure_circuit'],
    suppliers: getSuppliers(),
    categoryRisk: getCategoryRisk(),
    guardrails: getGuardrails(),
    profitability: getProfitability(),
  });
}
