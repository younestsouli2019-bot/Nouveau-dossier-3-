#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';

export const AGENT = {
  name: 'agent-swarm',
  appId: '689afeabf1db9c30efe0bd7e',
  key: process.env.BASE44_SWARM_API_KEY || '',
};

export function must(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function parseAmount(value) {
  const n = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

export function isoDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const ts = new Date(value);
  return Number.isNaN(ts.getTime()) ? fallback : ts.toISOString();
}

export async function base44List(entity, limit = 300) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=${limit}&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: AGENT.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

export async function base44Create(entity, payload) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Base44 create ${entity} failed ${res.status}: ${t}`);
  }
  return res.json();
}

export async function existingExternalIds(limit = 500) {
  const existing = await base44List('RevenueEvent', limit);
  return new Set(
    existing
      .map((e) => e.external_id || e.provider_event_id || e.invoice_id || null)
      .filter(Boolean)
      .map(String),
  );
}

export async function writeResult(fileName, payload) {
  await mkdir('dist_rwc', { recursive: true });
  await writeFile(`dist_rwc/${fileName}`, JSON.stringify(payload, null, 2));
}

