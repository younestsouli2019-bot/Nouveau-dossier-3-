
import { CryptoGateway } from '../financial/gateways/CryptoGateway.mjs';
import { LocalSwarmStore } from '../local-store.mjs';

async function approveCryptoPayments() {
    const store = new LocalSwarmStore();
    await store.init();

    const pendingTransactions = await store.list('RevenueEvent', { 
        status: 'PENDING_APPROVAL',
        type: 'CRYPTO'
    });

    if (pendingTransactions.length === 0) {
        console.log('No pending crypto payments to approve.');
        return;
    }

    const cryptoGateway = new CryptoGateway();
    const transactionsToPayout = pendingTransactions.map(tx => ({
        amount: tx.amount,
        currency: tx.currency,
        destination: tx.details.recipient_wallet,
        reference: `Payout for event ${tx.id}`
    }));

    try {
        const result = await cryptoGateway.executePayout(transactionsToPayout);
        console.log('Crypto payout successful:', result);

        for (const tx of pendingTransactions) {
            tx.status = 'PAID_OUT';
            await store.put(`RevenueEvent:${tx.id}`, tx);
        }
    } catch (error) {
        console.error('Crypto payout failed:', error);
    }
}

approveCryptoPayments();
