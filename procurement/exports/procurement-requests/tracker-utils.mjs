export const ORDER_STATUSES = ['pending', 'confirmed', 'ordered', 'shipped', 'delivered', 'cancelled'];

const STATUS_RANK = {
  pending: 0,
  confirmed: 1,
  ordered: 2,
  shipped: 3,
  delivered: 4,
  cancelled: 5,
};

export function normalizeItem(item = {}) {
  return {
    name: item.name || '',
    brand: item.brand ?? null,
    category: item.category || 'uncategorized',
    quantity: item.quantity || 1,
    vendor_assigned: item.vendor_assigned ?? null,
    price_quoted: item.price_quoted ?? null,
    currency: item.currency || 'MAD',
    order_status: item.order_status || 'pending',
    tracking_number: item.tracking_number ?? null,
    delivery_date: item.delivery_date ?? null,
    notes: item.notes ?? null,
    receipt_reference: item.receipt_reference ?? null,
    receipt_amount: item.receipt_amount ?? null,
    received_by: item.received_by ?? null,
    receipt_document_url: item.receipt_document_url ?? null,
    receipt_notes: item.receipt_notes ?? null,
    received_at: item.received_at ?? null,
    updated_at: item.updated_at ?? null,
  };
}

export function normalizeTracker(tracker = {}) {
  return {
    ...tracker,
    items: Array.isArray(tracker.items) ? tracker.items.map(normalizeItem) : [],
    vendors_contacted: Array.isArray(tracker.vendors_contacted) ? tracker.vendors_contacted : [],
    status: tracker.status || 'sourcing',
  };
}

export function parsePositiveMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

export function hasConfirmedReceipt(item) {
  return Boolean(item.receipt_reference && item.received_by && parsePositiveMoney(item.receipt_amount));
}

export function summarizeTracker(tracker) {
  const normalized = normalizeTracker(tracker);
  const total = normalized.items.length;
  const confirmed = normalized.items.filter((item) => item.price_quoted !== null).length;
  const ordered = normalized.items.filter((item) => item.order_status === 'ordered').length;
  const shipped = normalized.items.filter((item) => item.order_status === 'shipped').length;
  const delivered = normalized.items.filter((item) => item.order_status === 'delivered').length;
  const receiptConfirmed = normalized.items.filter(hasConfirmedReceipt).length;
  const totalCost = normalized.items.reduce((sum, item) => sum + ((item.price_quoted || 0) * item.quantity), 0);
  const receiptAmount = normalized.items.reduce((sum, item) => sum + (parsePositiveMoney(item.receipt_amount) || 0), 0);

  return {
    total,
    confirmed,
    ordered,
    shipped,
    delivered,
    receiptConfirmed,
    totalCost,
    receiptAmount,
    inTransit: ordered + shipped,
    progress: total > 0 ? Math.round((delivered / total) * 100) : 0,
  };
}

export function updateTrackerStatus(tracker) {
  const summary = summarizeTracker(tracker);

  if (summary.delivered === summary.total && summary.total > 0) {
    tracker.status = 'delivered';
  } else if (summary.shipped > 0) {
    tracker.status = 'shipping';
  } else if (summary.ordered > 0) {
    tracker.status = 'ordered';
  } else if (summary.confirmed > 0) {
    tracker.status = 'confirmed';
  } else if ((tracker.vendors_contacted || []).length > 0) {
    tracker.status = 'contacted';
  } else {
    tracker.status = 'sourcing';
  }

  tracker.total_actual = Number(summary.totalCost.toFixed(2));
  return tracker;
}

export function validateItemUpdate(currentItem, updates) {
  const nextStatus = updates.order_status || currentItem.order_status || 'pending';

  if (!ORDER_STATUSES.includes(nextStatus)) {
    return `Unsupported status "${nextStatus}". Allowed: ${ORDER_STATUSES.join(', ')}`;
  }

  const currentRank = STATUS_RANK[currentItem.order_status || 'pending'] ?? 0;
  const nextRank = STATUS_RANK[nextStatus] ?? 0;
  if (nextRank < currentRank && !(currentItem.order_status === 'delivered' && nextStatus === 'cancelled')) {
    return `Cannot move item backwards from ${currentItem.order_status} to ${nextStatus}`;
  }

  const vendorAssigned = updates.vendor_assigned ?? currentItem.vendor_assigned;
  const priceQuoted = updates.price_quoted ?? currentItem.price_quoted;
  const trackingNumber = updates.tracking_number ?? currentItem.tracking_number;
  const deliveryDate = updates.delivery_date ?? currentItem.delivery_date;
  const receiptReference = updates.receipt_reference ?? currentItem.receipt_reference;
  const receiptAmount = parsePositiveMoney(updates.receipt_amount ?? currentItem.receipt_amount);
  const receivedBy = updates.received_by ?? currentItem.received_by;

  if (['confirmed', 'ordered', 'shipped', 'delivered'].includes(nextStatus)) {
    if (!vendorAssigned) return 'Vendor assignment is required before confirming or ordering an item';
    if (priceQuoted === null || Number(priceQuoted) <= 0) return 'A positive quoted price is required before confirming or ordering an item';
  }

  if (['shipped', 'delivered'].includes(nextStatus) && !trackingNumber) {
    return 'Tracking number is required before marking an item as shipped or delivered';
  }

  if (nextStatus === 'delivered') {
    if (!deliveryDate) return 'Delivery date is required before marking an item as delivered';
    if (!receiptReference) return 'Receipt reference is required before marking an item as delivered';
    if (!receiptAmount) return 'Receipt amount must be greater than 0 before marking an item as delivered';
    if (!receivedBy) return 'Received by is required before marking an item as delivered';
  }

  return null;
}
