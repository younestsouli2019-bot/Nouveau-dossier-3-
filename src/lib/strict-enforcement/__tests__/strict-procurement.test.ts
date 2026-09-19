import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BUCKET_DEFAULT_PCT,
  TOP_LEVEL_BUCKET_CODES,
  getDisbursementPolicy,
  computeDisbursementPolicy,
  computeBucketSplit,
} from '../../treasury/buckets';
import {
  enforcePrepaidPolicy,
} from '../strict-procurement';

describe('AC-6 getDisbursementPolicy / computeBucketSplit (TR-1.1)', () => {
  it('bucketPct sum EXACTLY 100: Sovereign30 + Runtime20 + Salary10 + Debt40', () => {
    const p = getDisbursementPolicy();
    const sum = TOP_LEVEL_BUCKET_CODES.reduce((s, c) => s + (p.bucketPct[c] ?? 0), 0);
    expect(sum).toBe(100);
    expect(p.bucketPct.sovereign_reserves).toBe(30);
    expect(p.bucketPct.runtime_operations).toBe(20);
    expect(p.bucketPct.salary_bucket).toBe(10);
    expect(p.bucketPct.debt_repayment).toBe(40);
    expect(TOP_LEVEL_BUCKET_CODES).toEqual([
      'sovereign_reserves',
      'runtime_operations',
      'salary_bucket',
      'debt_repayment',
    ]);
    expect(p.profile.preferLocalSuppliersCountry).toBe('MA');
    expect(p.profile.debtDestination).toMatch(/RIB 372/);
    expect(p.procurementSubBudgetPctOfRuntime).toBe(50);
  });

  it('BUCKET_DEFAULT_PCT: 4 top-level entries ONLY sum 100, procurement_buffer excluded from %', () => {
    const keys = Object.keys(BUCKET_DEFAULT_PCT);
    expect(keys).toEqual(TOP_LEVEL_BUCKET_CODES as unknown as string[]);
    const total = TOP_LEVEL_BUCKET_CODES.reduce((s, c) => s + (BUCKET_DEFAULT_PCT[c] ?? 0), 0);
    expect(total).toBe(100);
  });

  it('computeDisbursementPolicy mutated sum 99 → throws BUCKET_SUM_MISMATCH fail-closed', () => {
    expect(() => computeDisbursementPolicy({ salary_bucket: 9 })).toThrow(/BUCKET_SUM_MISMATCH/i);
    expect(() => computeDisbursementPolicy({ sovereign_reserves: 50 })).toThrow(/BUCKET_SUM_MISMATCH/i);
    // Sum 100 → OK (salary becomes 10, nothing mutated total)
    expect(() => computeDisbursementPolicy({})).not.toThrow();
  });

  it('computeBucketSplit with sum != 100 → throws BUCKET_SUM_MISMATCH (no more silent drift into salary)', () => {
    // Top-level sum 100 → should not throw
    expect(() => computeBucketSplit(1000, {
      sovereign_reserves: 30, runtime_operations: 20, salary_bucket: 10, debt_repayment: 40,
    })).not.toThrow();
    // Sum 99 → throws
    expect(() => computeBucketSplit(1000, {
      sovereign_reserves: 29, runtime_operations: 20, salary_bucket: 10, debt_repayment: 40,
    })).toThrow(/BUCKET_SUM_MISMATCH/);
  });

  it('computeBucketSplit amounts: $1000 NET → split 300/200/100/400 USD across 4 buckets', () => {
    const s = computeBucketSplit(1000, {
      sovereign_reserves: 30, runtime_operations: 20, salary_bucket: 10, debt_repayment: 40,
    });
    const by: Record<string, number> = {};
    for (const r of s) by[r.code] = r.amount;
    expect(by.sovereign_reserves).toBe(300);
    expect(by.runtime_operations).toBe(200);
    expect(by.salary_bucket).toBe(100);
    expect(by.debt_repayment).toBe(400);
  });
});

describe('AC-1 enforcePrepaidPolicy (owner-initiated → prePaidBySwarm locked TRUE)', () => {
  it('ownerInitiated=true (default): prePaidBySwarm=false → violation TRUTH-PROC-002', () => {
    const r = enforcePrepaidPolicy({ ownerInitiated: true, prePaidBySwarm: false });
    expect(r.valid).toBe(false);
    expect(r.prePaidBySwarm).toBe(true);
    expect(r.ownerInitiated).toBe(true);
    expect(r.violations.join('|')).toMatch(/TRUTH-PROC-002/);
  });

  it('third-party PO (ownerInitiated=false, prePaidBySwarm=false): valid no violation', () => {
    const r = enforcePrepaidPolicy({ ownerInitiated: false, prePaidBySwarm: false });
    expect(r.valid).toBe(true);
    expect(r.violations.length).toBe(0);
    expect(r.prePaidBySwarm).toBe(false);
  });
});
