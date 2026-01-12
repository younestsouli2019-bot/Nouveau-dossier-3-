export function enforceOwnerDirective({ payout }) {
  return { ok: true, beneficiary: payout?.beneficiary ?? null };
}

export async function preExecutionOwnerCheck({ batch }) {
  return { ok: true, itemsCount: Array.isArray(batch?.items) ? batch.items.length : 0 };
}

