
import { PayPalGateway } from '../financial/gateways/PayPalGateway.mjs';
import { LocalSwarmStore } from '../local-store.mjs';

async function approvePayPalPayments() {
    const store = new LocalSwarmStore();
    await store.init();

    const pendingTransactions = await store.list('RevenueEvent', { 
        status: 'PENDING_APPROVAL',
        type: 'PAYPAL'
    });

    if (pendingTransactions.length === 0) {
        console.log('No pending PayPal payments to approve.');
        return;
    }

    const paypalGateway = new PayPalGateway();
    const transactionsToPayout = pendingTransactions.map(tx => ({
        amount: tx.amount,
        currency: tx.currency,
        destination: tx.details.recipient_email,
        reference: `Payout for event ${tx.id}`
    }));

    try {
        const result = await paypalGateway.executePayout(transactionsToPayout);
        console.log('PayPal payout successful:', result);

        for (const tx of pendingTransactions) {
            tx.status = 'PAID_OUT';
            await store.put(`RevenueEvent:${tx.id}`, tx);
        }
    } catch (error) {
        console.error('PayPal payout failed:', error);
    }
}

approvePayPalPayments();
