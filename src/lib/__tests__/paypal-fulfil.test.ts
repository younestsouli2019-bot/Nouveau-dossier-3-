import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/paypal-checkout', () => ({
  getOrder: vi.fn(),
  verifyOrder: vi.fn(),
}));
vi.mock('@/lib/rwc-order-ledger', () => ({
  findOrderBySession: vi.fn(),
  appendOrder: vi.fn(),
}));
vi.mock('@/lib/rwc-delivery', () => ({
  sendCourseReceipt: vi.fn(),
}));

import { fulfilPayPalOrder } from '@/lib/paypal-fulfil';
import { getOrder, verifyOrder } from '@/lib/paypal-checkout';
import { findOrderBySession, appendOrder } from '@/lib/rwc-order-ledger';
import { sendCourseReceipt } from '@/lib/rwc-delivery';

const SLUG = 'certified-blockchain-expert-cbe-preptest-2025';
const ORDER_ID = 'ORDER-123';

const order = (over: Record<string, any> = {}) => ({
  id: ORDER_ID,
  status: 'COMPLETED',
  payer: { email_address: 'buyer@example.com' },
  purchase_units: [{ reference_id: SLUG, amount: { value: '19.00', currency_code: 'USD' } }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RWC_PRICE_OVERRIDES;
  process.env.RWC_BASE_PRICE_USD = '19';
  (findOrderBySession as any).mockResolvedValue(null);
  (appendOrder as any).mockResolvedValue(undefined);
  (sendCourseReceipt as any).mockResolvedValue({ ok: true });
  (getOrder as any).mockResolvedValue(order());
  (verifyOrder as any).mockReturnValue({ ok: true, amount: '19.00', captureId: 'CAP-1' });
});

describe('fulfilPayPalOrder', () => {
  it('is idempotent: an already-delivered order is never re-sent', async () => {
    (findOrderBySession as any).mockResolvedValue({ delivery: 'SENT', slug: SLUG, title: 'T' });
    const r = await fulfilPayPalOrder(ORDER_ID);
    expect(r).toMatchObject({ ok: true, reason: 'already_fulfilled' });
    expect(sendCourseReceipt).not.toHaveBeenCalled();
    expect(appendOrder).not.toHaveBeenCalled();
  });

  it('rejects an unknown course slug without sending anything', async () => {
    (getOrder as any).mockResolvedValue(order({ purchase_units: [{ reference_id: 'nope', amount: { value: '19.00', currency_code: 'USD' } }] }));
    const r = await fulfilPayPalOrder(ORDER_ID);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unknown_slug');
    expect(sendCourseReceipt).not.toHaveBeenCalled();
  });

  it('does not fulfil when the capture fails verification', async () => {
    (verifyOrder as any).mockReturnValue({ ok: false, reason: 'amount_mismatch' });
    const r = await fulfilPayPalOrder(ORDER_ID);
    expect(r).toMatchObject({ ok: false, reason: 'amount_mismatch' });
    expect(sendCourseReceipt).not.toHaveBeenCalled();
    expect(appendOrder).not.toHaveBeenCalled();
  });

  it('records PAID/SENT and emails the receipt on success', async () => {
    const r = await fulfilPayPalOrder(ORDER_ID);
    expect(r.ok).toBe(true);
    expect(sendCourseReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'buyer@example.com', slug: SLUG, amountTotal: 19, currency: 'USD' }),
    );
    expect(appendOrder).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: ORDER_ID, status: 'PAID', delivery: 'SENT', currency: 'USD' }),
    );
  });

  it('keeps the order PENDING when the email provider is unavailable', async () => {
    (sendCourseReceipt as any).mockResolvedValue({ ok: false, detail: 'RESEND_API_KEY not set' });
    const r = await fulfilPayPalOrder(ORDER_ID);
    expect(r.ok).toBe(true);
    expect(appendOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID', delivery: 'PENDING' }),
    );
  });
});
