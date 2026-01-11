import { paypalRequest, getPayPalAccessToken } from '../../paypal-api.mjs';
import fs from 'fs';
import path from 'path';

export class PayPalGateway {
    constructor() {
        this.outputDir = path.join(process.cwd(), 'settlements', 'paypal');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async createPayout(amount, currency, destination, reason) {
        const token = await getPayPalAccessToken();
        const body = {
            sender_batch_header: {
                sender_batch_id: `owner_payout_${Date.now()}`,
                email_subject: reason,
                email_message: "Here is your payout."
            },
            items: [
                {
                    recipient_type: "EMAIL",
                    amount: {
                        value: String(amount),
                        currency: currency
                    },
                    receiver: destination,
                    note: reason,
                    sender_item_id: `item_${Date.now()}`
                }
            ]
        };

        return paypalRequest('/v1/payments/payouts', {
            method: 'POST',
            token,
            body
        });
    }

    async executePayout(transactions) {
        return await this.createInvoices(transactions);
    }

    async createInvoices(transactions) {
        const results = [];
        
        for (const tx of transactions) {
            const link = `https://www.paypal.com/invoice/create?amount=${tx.amount}&currency=${tx.currency}&payer=${tx.destination}`;
            results.push({ status: 'INVOICE_LINK_GENERATED', link, amount: tx.amount, payer: tx.destination });
        }
        
        return {
            status: 'INVOICES_READY',
            results,
            mode: 'BILLING'
        };
    }

    generateInstruction(amount, currency, email, reason) {
        const timestamp = Date.now();
        const filename = `paypal_instruction_${timestamp}.json`;
        const filePath = path.join(this.outputDir, filename);
        
        const instruction = {
            type: 'PAYPAL_PAYOUT',
            amount,
            currency,
            recipient: email,
            reason,
            timestamp: new Date().toISOString(),
            status: 'WAITING_MANUAL_EXECUTION'
        };
        
        fs.writeFileSync(filePath, JSON.stringify(instruction, null, 2));
        
        return {
            status: 'WAITING_MANUAL',
            filePath,
            instruction: 'Log in to PayPal and send manually'
        };
    }
}
