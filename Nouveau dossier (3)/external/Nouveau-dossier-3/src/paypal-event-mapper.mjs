function getAmountFromCapture(resource) {
  const amount = resource?.amount;
  if (!amount) return null;
  const value = Number(amount.value);
  if (Number.isNaN(value)) return null;
  const currency = amount.currency_code || amount.currency || null;
  return { value, currency };
}

function isPaymentCaptureCompleted(evt) {
  if (!evt || typeof evt !== "object") return false;
  if (evt.event_type === "PAYMENT.CAPTURE.COMPLETED") return true;
  if (evt.event_type === "CHECKOUT.ORDER.APPROVED") return false;
  return false;
}

export function mapPayPalWebhookToRevenueEvent(evt, { defaultCurrency = "USD" } = {}) {
  if (!isPaymentCaptureCompleted(evt)) return null;

  const resource = evt.resource ?? null;
  const amount = getAmountFromCapture(resource);
  if (!amount) return null;
  if (!amount.value || amount.value <= 0) return null;

  const occurredAt = evt.create_time ?? new Date().toISOString();
  const externalId = evt.id ?? resource?.id ?? null;
  if (!externalId) return null;

  return {
    amount: amount.value,
    currency: (amount.currency ?? defaultCurrency) || defaultCurrency,
    occurredAt,
    source: "paypal",
    externalId,
    metadata: {
      paypal_event_type: evt.event_type ?? null,
      paypal_capture_id: resource?.id ?? null,
      paypal_status: resource?.status ?? null,
      paypal_custom_id: resource?.custom_id ?? null,
      paypal_invoice_id: resource?.invoice_id ?? null
    }
  };
}

