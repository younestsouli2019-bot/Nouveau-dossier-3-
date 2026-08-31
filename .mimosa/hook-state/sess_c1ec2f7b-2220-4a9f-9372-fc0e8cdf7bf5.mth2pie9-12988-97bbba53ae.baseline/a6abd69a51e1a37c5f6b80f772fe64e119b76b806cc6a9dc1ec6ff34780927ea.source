
import { ReplenishmentProtocol } from './finance/ReplenishmentProtocol.mjs';
import { PayPalGateway } from './financial/gateways/PayPalGateway.mjs';
import { CryptoGateway } from './financial/gateways/CryptoGateway.mjs';
import { BankWireGateway } from './financial/gateways/BankWireGateway.mjs';
import { PayoneerGateway } from './financial/gateways/PayoneerGateway.mjs';
import { InstructionGateway } from './financial/gateways/InstructionGateway.mjs';
import { autoCorrectToOwner } from './owner-directive.mjs';

class RevenueCollector {
    constructor() {
        this.gateways = {
            'paypal': new PayPalGateway(),
            'crypto': new CryptoGateway(),
            'bankwire': new BankWireGateway(),
            'payoneer': new PayoneerGateway(),
            'instruction': new InstructionGateway(),
        };
        this.replenishmentProtocol = new ReplenishmentProtocol();
    }

    async collectRevenue(transactions) {
        const collectionTasks = transactions.map(tx => this.routeTransaction(tx));
        const results = await Promise.all(collectionTasks);
        return results;
    }

    async routeTransaction(transaction) {
        const { preferredGateway, ...txDetails } = transaction;
        const gateway = this.gateways[preferredGateway] || this.gateways['instruction'];
        
        if (!gateway) {
            throw new Error(`No gateway found for ${preferredGateway}`);
        }

        const ownerAddress = autoCorrectToOwner(preferredGateway.toUpperCase());
        const transactionWithRecipient = { ...txDetails, destination: ownerAddress };

        try {
            const result = await gateway.executePayout([transactionWithRecipient]);
            return { success: true, gateway: preferredGateway, result };
        } catch (error) {
            return { success: false, gateway: preferredGateway, error: error.message };
        }
    }

    async ensureSystemHealth() {
        await this.replenishmentProtocol.init();
        await this.replenishmentProtocol.executeReplenishment();
    }
}

export default new RevenueCollector();
