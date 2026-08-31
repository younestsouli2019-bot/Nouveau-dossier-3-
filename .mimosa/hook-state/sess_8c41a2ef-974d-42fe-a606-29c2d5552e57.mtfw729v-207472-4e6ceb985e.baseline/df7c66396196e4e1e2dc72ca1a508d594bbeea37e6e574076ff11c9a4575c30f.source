
import { LocalSwarmStore } from './local-store.mjs';
import { PayPalGateway } from './financial/gateways/PayPalGateway.mjs';
import { CryptoGateway } from './financial/gateways/CryptoGateway.mjs';
import { BankWireGateway } from './financial/gateways/BankWireGateway.mjs';

class RevenueGenerator {
    constructor() {
        this.store = new LocalSwarmStore();
        this.gateways = {
            'paypal': new PayPalGateway(),
            'crypto': new CryptoGateway(),
            'bankwire': new BankWireGateway(),
        };
    }

    async generateInvoices(invoiceRequests) {
        const invoiceTasks = invoiceRequests.map(req => this.createInvoice(req));
        const results = await Promise.all(invoiceTasks);
        return results;
    }

    async createInvoice(request) {
        const { gateway, ...invoiceDetails } = request;
        const selectedGateway = this.gateways[gateway];

        if (!selectedGateway || !selectedGateway.createInvoices) {
            throw new Error(`Invoice generation not supported for ${gateway}`);
        }

        try {
            const result = await selectedGateway.createInvoices([invoiceDetails]);
            const invoiceEvent = {
                id: `invoice_${Date.now()}`,
                status: 'INVOICE_GENERATED',
                gateway,
                details: result,
                createdAt: new Date().toISOString()
            };
            await this.store.put(`InvoiceEvent:${invoiceEvent.id}`, invoiceEvent);
            return { success: true, gateway, result };
        } catch (error) {
            return { success: false, gateway, error: error.message };
        }
    }
}

export default new RevenueGenerator();
