/**
 * Course receipt / delivery email for RealWorldCerts card checkout.
 *
 * Provider: Resend (single HTTPS call, no SDK dependency).
 * Fail-closed: without RESEND_API_KEY the send is skipped and the order
 * stays PENDING in the ledger, replayable later — a payment is never lost
 * because the mail provider was unconfigured.
 */

export interface ReceiptInput {
  email: string;
  slug: string;
  title: string;
  amountTotal: number;
  currency: string;
}

export interface ReceiptResult {
  ok: boolean;
  detail?: string;
}

const FROM = process.env.RWC_RECEIPT_FROM || 'RealWorldCerts <billing@realworldcerts.com>';

export async function sendCourseReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = input.email.trim();
  if (!apiKey) return { ok: false, detail: 'RESEND_API_KEY not set — order recorded, delivery pending' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, detail: 'buyer email missing from Stripe session' };

  const subject = `Your course access: ${input.title}`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="color:#0a2540">Thank you — your order is confirmed 🎉</h2>
    <p>Your payment of <strong>${input.amountTotal.toFixed(2)} ${input.currency.toUpperCase()}</strong> for
    <strong>${input.title}</strong> was received.</p>
    <p>Your full practice-test bank, answer explanations, and lifetime-access instructions are being prepared
    and will follow in a separate email from our delivery team. This is your receipt — keep it for your records.</p>
    <p style="margin-top:24px">Questions or anything urgent? Reply to this email or write to
    <a href="mailto:billing@realworldcerts.com">billing@realworldcerts.com</a>.</p>
    <p style="color:#666;font-size:12px;margin-top:32px">RealWorldCerts · Order ref: ${input.slug}</p>
  </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[rwc-delivery] Resend error', res.status, body.slice(0, 300));
      return { ok: false, detail: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[rwc-delivery] Resend unreachable', err);
    return { ok: false, detail: 'Resend unreachable' };
  }
}
