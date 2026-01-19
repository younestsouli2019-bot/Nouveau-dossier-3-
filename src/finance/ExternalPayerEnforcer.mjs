import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalSwarmStore } from '../local-store.mjs';

export class ExternalPayerEnforcer {
    constructor() {
        this.store = new LocalSwarmStore();
        this.registryPath = path.resolve('data/external_payers_registry.json');
        this.reportPath = path.resolve('reports/external_collections.md');
    }

    async init() {
        await this.store.init();
    }

    async runEnforcementCycle() {
        console.log('[Enforcer] Starting enforcement cycle...');
        
        // 1. Load Payers
        const registry = JSON.parse(await fs.readFile(this.registryPath, 'utf8'));
        const payers = registry.external_payers;

        // 2. Scan Pending Revenues
        const allEvents = await this.store.list('RevenueEvent');
        const pending = allEvents.filter(e => e.status === 'settled_externally_pending');

        const collections = [];

        for (const payer of payers) {
            const payerEvents = pending.filter(e => e.metadata?.payer_email === payer.email);
            if (payerEvents.length === 0) continue;

            const totalDue = payerEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
            
            // Group by Reference/Invoice
            const invoices = {};
            payerEvents.forEach(e => {
                const ref = e.metadata?.reference || 'Unreferenced';
                if (!invoices[ref]) invoices[ref] = { count: 0, amount: 0, oldest: e.created_date };
                invoices[ref].count++;
                invoices[ref].amount += e.amount;
            });

            collections.push({
                payer: payer.name,
                email: payer.email,
                total_due: totalDue.toFixed(2),
                currency: payerEvents[0]?.currency || 'USD',
                invoice_breakdown: invoices,
                action_required: "Send Demand Letter"
            });
        }

        // TRIGGER STOP WORK ORDERS
        if (collections.length > 0) {
            console.warn(`[Enforcer] 🛑 ${collections.length} payers are overdue. Triggering STOP WORK protocols.`);
            // In a real distributed system, we would broadcast a 'suspend_service' event here.
            // For now, the PaymentAssuranceProtocol reads the same ledger state, so the block is implicit.
        }

        await this.generateReport(collections);
        return collections;
    }

    async generateReport(collections) {
        let md = `# External Collections Report\nGenerated: ${new Date().toISOString()}\n\n`;
        
        if (collections.length === 0) {
            md += "✅ No overdue external payments detected.\n";
        } else {
            md += `🚨 **Action Required: ${collections.length} Payers with Outstanding Balances**\n\n`;
            
            for (const c of collections) {
                md += `### Payer: ${c.payer} (${c.email})\n`;
                md += `- **Total Due:** ${c.total_due} ${c.currency}\n`;
                md += `- **Status:** ⚠️ PENDING SETTLEMENT\n`;
                md += `- **Invoices:**\n`;
                for (const [ref, details] of Object.entries(c.invoice_breakdown)) {
                    md += `  - **${ref}**: ${details.amount.toFixed(2)} ${c.currency} (${details.count} items)\n`;
                }
                md += `\n**Recommended Action:**\n`;
                md += `> SEND DEMAND LETTER: "Please settle outstanding balance of ${c.total_due} ${c.currency} immediately per terms."\n\n`;
                md += `---\n`;
            }
        }

        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, md);
        console.log(`[Enforcer] Report generated at ${this.reportPath}`);
    }
}
