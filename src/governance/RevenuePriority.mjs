import fs from 'fs';
import path from 'path';

/**
 * REVENUE PRIORITY GOVERNANCE
 * Enforces "Less is More" by starving non-revenue tasks when financial health is low.
 */
export class RevenuePriority {
  constructor() {
    this.baseDir = './data/finance/events';
    this.cache = {
      lastCheck: 0,
      isHealthy: false,
      revenue7Days: 0
    };
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.MIN_REVENUE_THRESHOLD = 100; // $100 in last 7 days to allow charity
  }

  check(task) {
    // 1. Always allow Revenue/Critical tasks
    if (this.isRevenueTask(task)) {
      return { ok: true, priority: 'high' };
    }

    // 2. Check Financial Health for Discretionary/Charity tasks
    if (this.isDiscretionaryTask(task)) {
      this.updateFinancialHealth();
      
      if (!this.cache.isHealthy) {
        return { 
          ok: false, 
          reason: `BLOCKED_FINANCIAL_HEALTH: Revenue (${this.cache.revenue7Days} USD) below threshold (${this.MIN_REVENUE_THRESHOLD} USD). Focus on SALES.` 
        };
      }
    }

    // Default: Allow operational tasks
    return { ok: true };
  }

  isRevenueTask(task) {
    const type = (task.type || '').toUpperCase();
    const category = (task.category || '').toUpperCase();
    
    return (
      type.includes('REVENUE') ||
      type.includes('SALES') ||
      type.includes('TRADE') ||
      type.includes('SETTLEMENT') ||
      type.includes('HARVEST') ||
      category === 'REVENUE' ||
      category === 'FINANCE'
    );
  }

  isDiscretionaryTask(task) {
    const type = (task.type || '').toUpperCase();
    const category = (task.category || '').toUpperCase();
    const isCharity = task.is_charity || task.metadata?.is_charity;

    return (
      isCharity ||
      category === 'PHILANTHROPY' ||
      category === 'CHARITY' ||
      type.includes('DONATION') ||
      type.includes('PRO-BONO')
    );
  }

  updateFinancialHealth() {
    const now = Date.now();
    if (now - this.cache.lastCheck < this.CACHE_TTL) return;

    try {
      if (!fs.existsSync(this.baseDir)) {
        this.cache = { lastCheck: now, isHealthy: false, revenue7Days: 0 };
        return;
      }

      const files = fs.readdirSync(this.baseDir);
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      let revenue = 0;

      for (const file of files) {
        // Optimization: Check file mtime before reading? 
        // For now, assume filenames might not be timestamped, but content has timestamp.
        // Actually AdvancedFinancialManager saves as id.json.
        // We'll read files. If directory is huge, this needs optimization (e.g. index).
        // Assuming manageable size for now or we rely on 'events' being reasonable.
        
        // Quick path: skip if we have too many files? 
        // Let's try to read recent ones.
        
        try {
          const content = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
          const event = JSON.parse(content);
          
          if (new Date(event.timestamp).getTime() > sevenDaysAgo) {
            if (event.amount && (event.status === 'verified' || event.status === 'settled')) {
               revenue += parseFloat(event.amount);
            }
          }
        } catch (e) {
          continue;
        }
      }

      this.cache = {
        lastCheck: now,
        isHealthy: revenue >= this.MIN_REVENUE_THRESHOLD,
        revenue7Days: revenue
      };
      
    } catch (error) {
      console.error('Governance Financial Check Failed:', error);
      // Fail safe: Block charity if we can't verify funds
      this.cache = { lastCheck: now, isHealthy: false, revenue7Days: 0 };
    }
  }
}
