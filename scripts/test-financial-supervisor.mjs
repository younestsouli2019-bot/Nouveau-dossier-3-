#!/usr/bin/env node
/**
 * test-financial-supervisor.mjs — locks the budget accrual model.
 *
 * Regression target: earlier versions added PCT% of the WHOLE balance on every
 * 2-hour run, so a constant balance inflated the budget forever. The model now
 * accrues only on NEW revenue via a high-water mark, and a sweep that lowers
 * the balance never claws budget back.
 *
 * Run: node scripts/test-financial-supervisor.mjs   (exit 0 = model intact)
 */
const { computeDecision } = await import('../scripts/financial-supervisor.mjs');

const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail });
const run = (args) => computeDecision({ now: '2026-11-03T17:00:00.000Z', ...args });

// ── 1. no revenue ───────────────────────────────────────────────────────────
const a = run({ gross: 0 });
check('zero revenue -> HOLD, budget 0', a.decision === 'HOLD' && a.budget_after === 0, JSON.stringify([a.decision, a.budget_after]));

// ── 2. first revenue: 100 USDT -> 30 budget -> Starter (16) affordable ──────
const b = run({ gross: 100, budgetBefore: 0, cumBefore: 0 });
check('100 USDT revenue -> budget 30', b.budget_after === 30, String(b.budget_after));
check('30 budget -> Starter due', b.target_plan === 'Starter' && b.decision === 'UPGRADE_DUE', JSON.stringify([b.target_plan, b.decision]));

// ── 3. SAME balance on the next run must add nothing ───────────────────────
const c = run({ gross: 100, budgetBefore: 30, cumBefore: 100 });
check('repeat run on same balance adds 0 (no double-count)', c.budget_after === 30, String(c.budget_after));
check('repeat run reports new_revenue 0', c.new_revenue_usdt === 0, String(c.new_revenue_usdt));

// ── 4. a sweep lowers the balance: no clawback ─────────────────────────────
const d = run({ gross: 40, budgetBefore: 30, cumBefore: 100 });
check('sweep dip (100 -> 40) keeps budget at 30', d.budget_after === 30, String(d.budget_after));
check('cumulative high-water stays 100', d.cum_gross_usdt === 100, String(d.cum_gross_usdt));

// ── 5. growth accrues only on the increment ────────────────────────────────
const e = run({ gross: 200, budgetBefore: 30, cumBefore: 100 });
check('growth 100 -> 200 adds 30 (not 60)', e.budget_after === 60, String(e.budget_after));
check('60 budget -> Builder due (highest affordable)', e.target_plan === 'Builder', String(e.target_plan));

// ── 6. ladder picks the highest affordable tier ────────────────────────────
const f = run({ gross: 300, budgetBefore: 85, cumBefore: 300 });
check('85+0 budget -> Pro, not Elite', f.target_plan === 'Pro' && f.target_cost_usd === 80, JSON.stringify([f.target_plan, f.target_cost_usd]));

// ── 7. just under the first tier stays HOLD ────────────────────────────────
const g = run({ gross: 53.3, budgetBefore: 0, cumBefore: 0 });
check('15.99 budget stays HOLD', g.decision === 'HOLD' && g.target_plan === null, String(g.budget_after));
const h = run({ gross: 53.34, budgetBefore: 0, cumBefore: 0 });
check('16.00 budget fires Starter', h.target_plan === 'Starter', String(h.budget_after));

// ── 8. custom pct respected ────────────────────────────────────────────────
const i = run({ gross: 100, budgetBefore: 0, cumBefore: 0, pct: 50 });
check('pct override (50%) -> budget 50', i.budget_after === 50, String(i.budget_after));

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${r.detail}`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed ? 1 : 0);
