import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const COMPLIANCE_DIR = path.join(ROOT, 'data', 'compliance');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

const FX_RATES = {
  USD: 10.0, EUR: 10.8, GBP: 12.7, JPY: 0.069, MAD: 1.0,
};

const TAX_REGIMES = {
  AUTO_ENTREPRENEUR: {
    name: 'Auto-Entrepreneur',
    maxAnnualRevenueMAD: 100_000,
    er: 1,      // IR rate
    vatExempt: true,
    notes: 'Simplified regime for services. Annual cap ~100,000 MAD. No VAT.',
  },
  IR: {
    name: 'Impôt sur le Revenu (IR)',
    maxAnnualRevenueMAD: 38_000_00,
    er: 0.38,
    vatExempt: true,
    notes: 'Progressive IR scale (0-38%). Applicable if auto-entrepreneur cap exceeded.',
  },
  IS: {
    name: 'Impôt sur les Sociétés (IS)',
    maxAnnualRevenueMAD: Infinity,
    er: 0.20,
    vatExempt: false,
    notes: 'Corporate tax 20% standard rate. Requires SARL formation.',
  },
};

class MoroccoTaxCompliance {
  constructor() {
    this._initialized = false;
    this._currentYear = new Date().getFullYear();
    this._yearlyRevenue = { MAD: 0, USD: 0, EUR: 0, GBP: 0, USDC: 0, ETH: 0, HAIO: 0 };
    this._earnings = [];
  }

  async init() {
    if (this._initialized) return;
    mkdirSync(COMPLIANCE_DIR, { recursive: true });
    await this._loadYearlyState();
    this._initialized = true;
  }

  async _loadYearlyState() {
    const file = path.join(COMPLIANCE_DIR, `fy-${this._currentYear}.json`);
    if (existsSync(file)) {
      try {
        const data = JSON.parse(await fs.readFile(file, 'utf-8'));
        this._yearlyRevenue = data.yearlyRevenue || this._yearlyRevenue;
        this._earnings = data.earnings || [];
      } catch {
        this._yearlyRevenue = { MAD: 0, USD: 0, EUR: 0, GBP: 0, USDC: 0, ETH: 0, HAIO: 0 };
        this._earnings = [];
      }
    }
  }

  async _saveYearlyState() {
    const file = path.join(COMPLIANCE_DIR, `fy-${this._currentYear}.json`);
    await fs.writeFile(file, JSON.stringify({
      fiscalYear: this._currentYear,
      yearlyRevenue: this._yearlyRevenue,
      earnings: this._earnings.slice(-1000),
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  _loadTruth() {
    try { return JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf-8')); } catch { return null; }
  }

  _toMAD(amount, currency) {
    const rate = FX_RATES[currency] || 1;
    return amount * rate;
  }

  _determineRegime(yearlyMAD) {
    if (yearlyMAD <= TAX_REGIMES.AUTO_ENTREPRENEUR.maxAnnualRevenueMAD) {
      return TAX_REGIMES.AUTO_ENTREPRENEUR;
    }
    return TAX_REGIMES.IR;
  }

  classifyEarning(earning) {
    const { amount, currency, source } = earning;
    const amountMAD = this._toMAD(amount, currency);
    const isForeignCurrency = currency !== 'MAD';
    const totalMAD = this._yearlyRevenue.MAD + amountMAD;
    const regime = this._determineRegime(totalMAD);

    return {
      earningId: earning.earningId,
      amount,
      currency,
      amountMAD,
      source,
      isForeignCurrency,
      requiresRepatriation: isForeignCurrency,
      regime: regime.name,
      regimeMaxMAD: regime.maxAnnualRevenueMAD,
      vatExempt: regime.vatExempt,
      totalYearlyMAD: totalMAD,
      pctOfCap: regime.maxAnnualRevenueMAD > 0
        ? Number((totalMAD / regime.maxAnnualRevenueMAD * 100).toFixed(2))
        : 0,
      notes: isForeignCurrency
        ? `Foreign currency (${currency}) — must repatriate via Bank Al-Maghrib`
        : `Domestic currency (MAD) — standard treatment`,
    };
  }

  async recordEarning(earning) {
    await this.init();
    const classification = this.classifyEarning(earning);

    this._yearlyRevenue[currency] = (this._yearlyRevenue[currency] || 0) + amount;
    this._yearlyRevenue.MAD += classification.amountMAD;
    this._earnings.push(classification);

    await this._saveYearlyState();
    return classification;
  }

  async recordBatch(earnings) {
    const results = [];
    for (const e of earnings) {
      results.push(await this.recordEarning(e));
    }
    return results;
  }

  getYearlySummary() {
    const totalMAD = this._yearlyRevenue.MAD;
    const regime = this._determineRegime(totalMAD);
    const truth = this._loadTruth();
    const splits = truth?.settlementPolicy?.fundAllocation?.splits || [];
    const allocation = splits.map(s => ({
      id: s.id, label: s.label, pct: s.pct,
      amountMAD: Number((totalMAD * s.pct / 100).toFixed(2)),
    }));

    return {
      fiscalYear: this._currentYear,
      totalRevenueMAD: totalMAD,
      byCurrency: { ...this._yearlyRevenue },
      regime: regime.name,
      regimeCapMAD: regime.maxAnnualRevenueMAD,
      pctOfCapUsed: regime.maxAnnualRevenueMAD > 0
        ? Number((totalMAD / regime.maxAnnualRevenueMAD * 100).toFixed(2))
        : 0,
      vatExempt: regime.vatExempt,
      allocation10_40_50: allocation,
      foreignRevenueMAD: Object.entries(this._yearlyRevenue)
        .filter(([c]) => c !== 'MAD' && FX_RATES[c])
        .reduce((sum, [c, amt]) => sum + this._toMAD(amt, c), 0),
      repatriationRequired: true,
      totalEarningsRecorded: this._earnings.length,
    };
  }

  async generateAuditReport(period = 'yearly') {
    await this.init();
    const summary = this.getYearlySummary();
    const truth = this._loadTruth();

    const report = {
      reportType: `tax-audit-${period}`,
      generatedAt: new Date().toISOString(),
      owner: truth?.owner?.displayName || 'Younes Tsouli',
      nationalId: truth?.owner?.identity?.nationalId || 'A337773',
      fiscalYear: this._currentYear,
      summary,
      taxTreatment: {
        salaire: {
          pct: 10,
          treatment: 'Personal income (IR) — deductible business expense',
          regime: summary.regime,
        },
        dettes: {
          pct: 40,
          treatment: 'Debt repayment — non-taxable transfer',
          regime: 'N/A (liability settlement)',
        },
        operating: {
          pct: 50,
          treatment: 'Operating reserve — taxable under business income',
          regime: summary.regime,
        },
      },
      repatriationLog: this._earnings
        .filter(e => e.isForeignCurrency)
        .slice(-50),
      complianceFlags: [],
    };

    if (summary.pctOfCapUsed > 80 && summary.regime === 'Auto-Entrepreneur') {
      report.complianceFlags.push({
        severity: 'WARNING',
        message: `Approaching auto-entrepreneur cap (${summary.pctOfCapUsed}% used). Consider SARL formation.`,
      });
    }
    if (summary.foreignRevenueMAD > 0) {
      report.complianceFlags.push({
        severity: 'INFO',
        message: `Foreign revenue: ${summary.foreignRevenueMAD.toFixed(2)} MAD. Must repatriate through Bank Al-Maghrib.`,
      });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(COMPLIANCE_DIR, `audit-${stamp}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(COMPLIANCE_DIR, 'audit-latest.json'), JSON.stringify(report, null, 2));

    return { report, reportFile };
  }

  async checkThresholdAlert() {
    await this.init();
    const summary = this.getYearlySummary();
    const alerts = [];

    if (summary.pctOfCapUsed >= 80) {
      alerts.push({
        level: 'WARNING',
        message: `Auto-entrepreneur cap at ${summary.pctOfCapUsed}%. Threshold alert!`,
      });
    }
    if (summary.pctOfCapUsed >= 100) {
      alerts.push({
        level: 'CRITICAL',
        message: `AUTO-ENTREPRENEUR CAP EXCEEDED. Must transition to SARL or IR regime immediately.`,
      });
    }
    if (summary.foreignRevenueMAD > 0) {
      alerts.push({
        level: 'INFO',
        message: `Foreign revenue ${summary.foreignRevenueMAD.toFixed(2)} MAD requires repatriation.`,
      });
    }

    return { alerts, summary };
  }

  status() {
    return {
      initialized: this._initialized,
      fiscalYear: this._currentYear,
      totalRevenueMAD: this._yearlyRevenue.MAD,
      earningsRecorded: this._earnings.length,
      regime: this.getYearlySummary().regime,
    };
  }
}

const moroccoTax = new MoroccoTaxCompliance();
export default moroccoTax;
export { MoroccoTaxCompliance };
