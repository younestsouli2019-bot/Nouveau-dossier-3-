import { NextResponse } from 'next/server';
import { listProviders } from '@/edu/media/providers/router.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function summarize(p) {
  return {
    id: p.constructor.name || p.providerName,
    name: p.providerName,
    brandAlias: p.brandName || null,
    kind: p.providerKind || 'unknown',
    priority: Number(p.priority || 0),
    configured: Boolean(p.hasKey && p.hasKey()),
    freeTierAvailable: Boolean(p.isFree),
    requiresKey: Boolean(p.requiresKey),
    capabilities: Array.isArray(p.capabilities) ? p.capabilities : [],
    costUsdPerUnit: p.costUsdPerUnit || 0,
    lastRunTs: p.metrics?.lastRunTs || null,
    lastRunOk: p.metrics?.lastRunOk || false,
    totalRuns: Number(p.metrics?.totalRuns || 0),
    avgLatencyMs: Number(p.metrics?.avgLatencyMs || 0),
  };
}

export async function GET() {
  try {
    const image = listProviders('image');
    const video = listProviders('video');
    const tts = listProviders('tts');
    const byKind = {
      image: image.map(summarize),
      video: video.map(summarize),
      tts: tts.map(summarize),
    };
    const counts = {
      image: byKind.image.length,
      video: byKind.video.length,
      tts: byKind.tts.length,
      configuredImage: byKind.image.filter((p) => p.configured || p.freeTierAvailable).length,
      configuredVideo: byKind.video.filter((p) => p.configured || p.freeTierAvailable).length,
      configuredTts: byKind.tts.filter((p) => p.configured || p.freeTierAvailable).length,
    };
    return NextResponse.json({
      ok: true,
      status: 'active',
      updatedAt: new Date().toISOString(),
      counts,
      providers: byKind,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status: 'error',
      error: e?.message || String(e),
    }, { status: 500 });
  }
}
