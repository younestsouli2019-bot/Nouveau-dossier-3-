// Event Bus — Central Orchestrator for Inter-Module Communication
// Decoupled pub/sub pattern connecting Market Scout, Browser Swarm, Account Management,
// Payment Infrastructure, Financial Ledger, and Security Guardrails

export type SwarmEvent =
  | { type: 'opportunity.discovered'; payload: { opportunityId: string; name: string; score: number } }
  | { type: 'opportunity.validated'; payload: { opportunityId: string; supplierPrice: number; targetPrice: number } }
  | { type: 'opportunity.rejected'; payload: { opportunityId: string; reason: string } }
  | { type: 'account.provisioned'; payload: { accountId: string; platform: string } }
  | { type: 'account.warmed'; payload: { accountId: string; trustScore: number } }
  | { type: 'account.banned'; payload: { accountId: string; platform: string; reason: string } }
  | { type: 'browser.session.started'; payload: { profileId: string; targetUrl: string } }
  | { type: 'browser.session.completed'; payload: { profileId: string; actionsCount: number } }
  | { type: 'browser.warming.advanced'; payload: { profileId: string; newPhase: string } }
  | { type: 'card.created'; payload: { cardId: string; last4: string; spendingLimit: number } }
  | { type: 'card.funded'; payload: { cardId: string; amount: number; newBalance: number } }
  | { type: 'card.declined'; payload: { cardId: string; reason: string } }
  | { type: 'order.placed'; payload: { orderId: string; cardId: string; amount: number; merchant: string } }
  | { type: 'order.fulfilled'; payload: { orderId: string; deliveryDate: string } }
  | { type: 'order.returned'; payload: { orderId: string; reason: string } }
  | { type: 'settlement.initiated'; payload: { settlementId: string; amount: number } }
  | { type: 'settlement.completed'; payload: { settlementId: string; netAmount: number } }
  | { type: 'anomaly.detected'; payload: { severity: string; reason: string; action: string } }
  | { type: 'circuit_breaker.tripped'; payload: { reason: string; pausedUntil: string } }
  | { type: 'mfa.required'; payload: { accountId: string; method: string; platform: string } }
  | { type: 'mfa.verified'; payload: { accountId: string } };

export type EventHandler = (event: SwarmEvent) => void | Promise<void>;

export interface EventRecord {
  id: string;
  event: SwarmEvent;
  timestamp: Date;
  handlerCount: number;
  processedMs: number;
}

const subscribers: Map<string, EventHandler[]> = new Map();
const eventLog: EventRecord[] = [];
const MAX_LOG_SIZE = 10000;

export function subscribe(eventType: SwarmEvent['type'], handler: EventHandler): () => void {
  const handlers = subscribers.get(eventType) || [];
  handlers.push(handler);
  subscribers.set(eventType, handlers);

  // Return unsubscribe function
  return () => {
    const h = subscribers.get(eventType) || [];
    subscribers.set(eventType, h.filter(fn => fn !== handler));
  };
}

export function subscribeAll(handler: EventHandler): () => void {
  const allTypes: SwarmEvent['type'][] = [
    'opportunity.discovered', 'opportunity.validated', 'opportunity.rejected',
    'account.provisioned', 'account.warmed', 'account.banned',
    'browser.session.started', 'browser.session.completed', 'browser.warming.advanced',
    'card.created', 'card.funded', 'card.declined',
    'order.placed', 'order.fulfilled', 'order.returned',
    'settlement.initiated', 'settlement.completed',
    'anomaly.detected', 'circuit_breaker.tripped',
    'mfa.required', 'mfa.verified',
  ];

  const unsubs = allTypes.map(t => subscribe(t, handler));
  return () => unsubs.forEach(u => u());
}

export async function publish(event: SwarmEvent): Promise<EventRecord> {
  const startMs = Date.now();
  const handlers = subscribers.get(event.type) || [];
  const wildcardHandlers = subscribers.get('*') || [];
  const allHandlers = [...handlers, ...wildcardHandlers];

  for (const handler of allHandlers) {
    try {
      await handler(event);
    } catch (err) {
      console.error(`[EventBus] Handler error for ${event.type}:`, err);
    }
  }

  const record: EventRecord = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    timestamp: new Date(),
    handlerCount: allHandlers.length,
    processedMs: Date.now() - startMs,
  };

  eventLog.push(record);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.splice(0, eventLog.length - MAX_LOG_SIZE);
  }

  return record;
}

export function getEventLog(limit = 50): EventRecord[] {
  return eventLog.slice(-limit);
}

export function getSubscriberCount(): Record<string, number> {
  const counts: Record<string, number> = {};
  subscribers.forEach((handlers, type) => {
    counts[type] = handlers.length;
  });
  return counts;
}

// Convenience: wire standard cross-module reactions
export function wireSwarmReactions(): void {
  // When an opportunity is validated → provision an account on the supplier platform
  subscribe('opportunity.validated', async (event) => {
    console.log(`[EventBus] Opportunity validated: ${event.payload.opportunityId} — provisioning account`);
  });

  // When account is warmed → create VCC for it
  subscribe('account.warmed', async (event) => {
    console.log(`[EventBus] Account warmed: ${event.payload.accountId} — creating VCC`);
  });

  // When card is funded → ready to place orders
  subscribe('card.funded', async (event) => {
    console.log(`[EventBus] Card funded: ${event.payload.cardId} with $${event.payload.amount}`);
  });

  // When anomaly detected → log and potentially halt
  subscribe('anomaly.detected', async (event) => {
    console.warn(`[EventBus] ANOMALY: ${event.payload.severity} — ${event.payload.reason} — Action: ${event.payload.action}`);
  });

  // When circuit breaker tripped → pause all operations
  subscribe('circuit_breaker.tripped', async (event) => {
    console.error(`[EventBus] CIRCUIT BREAKER: ${event.payload.reason} — paused until ${event.payload.pausedUntil}`);
  });
}
