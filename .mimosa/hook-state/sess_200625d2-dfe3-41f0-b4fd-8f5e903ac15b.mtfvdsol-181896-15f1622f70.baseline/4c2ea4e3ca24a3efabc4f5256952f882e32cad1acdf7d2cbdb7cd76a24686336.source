
import { BankWireGateway } from '../financial/gateways/BankWireGateway.mjs';
import { LocalSwarmStore } from '../local-store.mjs';

async function approveBankWirePayments() {
    const store = new LocalSwarmStore();
    await store.init();

    const pendingTransactions = await store.list('RevenueEvent', { 
        status: 'PENDING_APPROVAL',
        type: 'BANK_WIRE'
    });

    if (pendingTransactions.length === 0) {
        console.log('No pending bank wire payments to approve.');
        return;
    }

    const bankWireGateway = new BankWireGateway();
    const transactionsToPayout = pendingTransactions.map(tx => ({
        amount: tx.amount,
        currency: tx.currency,
        destination: tx.details.recipient_bank_account,
        reference: `Payout for event ${tx.id}`
    }));

    try {
        const result = await bankWireGateway.executePayout(transactionsToPayout);
        console.log('Bank wire payout successful:', result);

        for (const tx of pendingTransactions) {
            tx.status = 'PAID_OUT';
            await store.put(`RevenueEvent:${tx.id}`, tx);
        }
    } catch (error) {
        console.error('Bank wire payout failed:', error);
    }
}

approveBankWirePayments();
