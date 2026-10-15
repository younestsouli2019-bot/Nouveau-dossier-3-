import { NextResponse } from "next/server";
import { FunnelStore, FUNNEL_STAGES } from "@/../src/edu/funnel-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function looksLikePii(value) {
  if (!value) return false;
  const v = String(value);
  if (/@/.test(v)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(v)) return true;
  if (/^[A-Z0-9._%+-]+@/.test(v)) return true;
  if (/\b(MASTER|VISA|AMEX)\b/i.test(v)) return true;
  if (/^\d{13,19}$/.test(v)) return true;
  if (/(RIB|IBAN|SWIFT|BIC)/i.test(v)) return true;
  return false;
}

export async function GET(request) {
  const url = new URL(request.url, "http://localhost");
  const stage = url.searchParams.get("stage");
  const sessionId = url.searchParams.get("sessionId") || url.searchParams.get("session_id");
  const orderReference = url.searchParams.get("orderReference") || url.searchParams.get("order_reference") || url.searchParams.get("ref");
  const slug = url.searchParams.get("slug") || url.searchParams.get("product_slug") || url.searchParams.get("product");

  if (!FUNNEL_STAGES.includes(stage)) {
    return NextResponse.json(
      { ok: false, error: "invalid_stage", allowed_stages: FUNNEL_STAGES },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // PII detection — drop silently but mark system event on any leak attempt
  for (const v of [stage, sessionId, orderReference, slug]) {
    if (looksLikePii(v)) {
      try {
        const store = new FunnelStore();
        store.track(stage, {
          sessionId,
          orderReference: null,
          product_slug: null,
          referer: null,
          pii_detected_dropped: true,
          detection_at: new Date().toISOString(),
          note: "PII detected in funnel query params — event scrubbed of PII fields per NFR-5 privacy. system.pii_detected_dropped auxiliary authoritative event appended.",
        });
      } catch {}
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, private",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  try {
    const store = new FunnelStore();
    const referer = request.headers.get("referer") || null;
    const ua = request.headers.get("user-agent") || null;
    store.track(stage, {
      sessionId,
      orderReference,
      product_slug: slug || null,
      referer_host: referer ? (() => { try { return new URL(referer).hostname; } catch { return null; } })() : null,
      user_agent_fingerprint: ua ? Buffer.from(ua).subarray(0, 200).toString("base64").substring(0, 64) : null,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    // Fail-soft for instrumentation only — tracking never breaks user journey.
    console.error("funnel track err:", e?.message?.substring?.(0, 200));
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Content-Type-Options": "nosniff",
      "X-Tracked-Stage": stage,
    },
  });
}
