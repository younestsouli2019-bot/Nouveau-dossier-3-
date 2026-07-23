/**
 * REAL PAYPAL REST API INTEGRATION
 * 
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 * 
 * NO SIMULATION. NO Math.random(). NO FAKE DATA.
 * Every call hits PayPal's live REST API.
 * Every response is externally confirmed.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class RealPayPalIntegration {
    constructor() {
        this.clientId = process.env.PAYPAL_CLIENT_ID;
        this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
        this.mode = process.env.PAYPAL_MODE || 'live';
        this.baseUrl = this.mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
        this.ownerEmail = process.env.OWNER_PAYPAL_EMAIL;
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.logDir = path.join(__dirname, '..', 'exports', 'settlement');
        this.txLog = path.join(this.logDir, 'real-paypal-transactions.json');
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        try {
            fs.appendFileSync(path.join(this.logDir, 'real-paypal.log'), line + '\n');
        } catch (e) { /* ok */ }
    }

    async request(method, endpoint, body = null) {
        const token = await this.getAccessToken();
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const options = {
                method,
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject({ status: res.statusCode, body: json, raw: data });
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject({ status: res.statusCode, raw: data });
                    }
                });
            });
            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    async getAccessToken() {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        this.log('Requesting new PayPal access token...');
        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        return new Promise((resolve, reject) => {
            const postData = 'grant_type=client_credentials';
            const req = https.request({
                hostname: 'api-m.paypal.com',
                path: '/v1/oauth2/token',
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.access_token) {
                            this.accessToken = json.access_token;
                            this.tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
                            this.log('PayPal access token acquired');
                            resolve(json.access_token);
                        } else {
                            this.log('PayPal auth FAILED: ' + JSON.stringify(json));
                            reject(json);
                        }
                    } catch (e) {
                        this.log('PayPal auth parse error: ' + data);
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    async getBalance() {
        this.log('Fetching real PayPal balance...');
        try {
            const result = await this.request('GET', '/v1/reporting/balances');
            const balances = result.balances || [];
            const primary = balances.find(b => b.primary === true) || balances[0];
            const balance = {
                source: 'PAYPAL_REST_API',
                timestamp: new Date().toISOString(),
                confirmed: true,
                primary_currency: primary ? primary.currency_code : 'USD',
                primary_balance: primary ? parseFloat(primary.balance.value) : 0,
                all_balances: balances.map(b => ({
                    currency: b.currency_code,
                    value: parseFloat(b.balance.value),
                    primary: b.primary
                })),
                raw_response: result
            };
            this.log(`Real PayPal balance: ${balance.primary_currency} ${balance.primary_balance}`);
            return balance;
        } catch (err) {
            this.log('PayPal balance fetch FAILED: ' + JSON.stringify(err));
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async listTransactions(startDate, endDate, pageSize = 50) {
        this.log(`Fetching real PayPal transactions from ${startDate} to ${endDate}...`);
        const start = startDate || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0] + 'T00:00:00Z';
        const end = endDate || new Date().toISOString().split('T')[0] + 'T23:59:59Z';
        try {
            const result = await this.request('GET',
                `/v1/reporting/transactions?start_date=${start}&end_date=${end}&page_size=${pageSize}&fields=all`
            );
            const transactions = (result.transaction_details || []).map(tx => ({
                id: tx.transaction_info.transaction_id,
                status: tx.transaction_info.transaction_status,
                amount: parseFloat(tx.transaction_info.transaction_amount.value),
                currency: tx.transaction_info.transaction_amount.currency_code,
                type: tx.transaction_info.transaction_type,
                subject: tx.transaction_info.subject,
                time: tx.transaction_info.time_utc,
                payer: tx.payer_info ? tx.payer_info.email_address : null,
                merchant: tx.merchant_info ? tx.merchant_info.email_address : null,
                fee: tx.transaction_info.fee_amount ? parseFloat(tx.transaction_info.fee_amount.value) : 0,
                net: tx.transaction_info.net_amount ? parseFloat(tx.transaction_info.net_amount.value) : 0
            }));
            this.log(`Fetched ${transactions.length} real PayPal transactions`);
            return {
                source: 'PAYPAL_REST_API',
                confirmed: true,
                timestamp: new Date().toISOString(),
                period: { start, end },
                total_transactions: transactions.length,
                transactions
            };
        } catch (err) {
            this.log('PayPal transactions fetch FAILED: ' + JSON.stringify(err));
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async createInvoice(invoiceData) {
        this.log('Creating real PayPal invoice...');
        const invoice = {
            detail: {
                invoice_number: invoiceData.invoice_number || `INV-${Date.now()}`,
                reference: invoiceData.reference || '',
                invoice_date: new Date().toISOString().split('T')[0],
                currency_code: invoiceData.currency || 'USD',
                note: invoiceData.note || '',
                term: invoiceData.term || '',
                memo: invoiceData.memo || ''
            },
            invoicer: {
                name: { given_name: invoiceData.sender_name || 'Younes Tsouli' },
                email_address: this.ownerEmail,
                phones: invoiceData.sender_phone ? [{
                    country_code: '212',
                    national_number: invoiceData.sender_phone,
                    phone_type: 'MOBILE'
                }] : []
            },
            primary_recipients: [{
                name: { given_name: invoiceData.recipient_name || '' },
                email_address: invoiceData.recipient_email || ''
            }],
            items: (invoiceData.items || []).map(item => ({
                name: item.name,
                description: item.description || '',
                quantity: String(item.quantity || 1),
                unit_amount: {
                    currency_code: invoiceData.currency || 'USD',
                    value: String(item.price)
                }
            })),
            configuration: {
                partial_payment: { allow_partial_payment: false },
                allow_tip: false
            }
        };

        try {
            const result = await this.request('POST', '/v2/invoicing/invoices', invoice);
            const invoiceId = result.rel ? result.rel.find(r => r.method === 'GET' && r.rel === 'self') : null;
            const invoiceUrl = result.links ? result.links.find(l => l.rel === 'payer-view') : null;
            this.log(`PayPal invoice created: ${result.id || 'unknown'}`);
            return {
                source: 'PAYPAL_REST_API',
                confirmed: true,
                timestamp: new Date().toISOString(),
                invoice_id: result.id,
                status: result.status,
                invoice_number: invoice.detail.invoice_number,
                payer_view_url: invoiceUrl ? invoiceUrl.href : null,
                total: invoiceData.items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0),
                currency: invoiceData.currency || 'USD'
            };
        } catch (err) {
            this.log('PayPal invoice creation FAILED: ' + JSON.stringify(err));
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async sendInvoice(invoiceId) {
        this.log(`Sending PayPal invoice ${invoiceId}...`);
        try {
            const result = await this.request('POST', `/v2/invoicing/invoices/${invoiceId}/send`);
            this.log(`Invoice sent successfully`);
            return { source: 'PAYPAL_REST_API', confirmed: true, result };
        } catch (err) {
            this.log('Invoice send FAILED: ' + JSON.stringify(err));
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async getInvoice(invoiceId) {
        this.log(`Fetching PayPal invoice ${invoiceId}...`);
        try {
            const result = await this.request('GET', `/v2/invoicing/invoices/${invoiceId}`);
            const amount = result.amount ? parseFloat(result.amount.value) : null;
            const currency = result.amount ? result.amount.currency_code : null;
            const paidAmount = result.payments && result.payments.paid_amount
                ? parseFloat(result.payments.paid_amount.value) : null;
            const transactions = result.payments && result.payments.transactions
                ? result.payments.transactions.map(t => ({
                    type: t.type,
                    payment_id: t.payment_id,
                    status: t.transaction_status,
                    amount: t.amount ? parseFloat(t.amount.value) : null,
                    currency: t.amount ? t.amount.currency_code : null,
                    date: t.payment_date
                })) : [];
            const recipient = result.primary_recipients && result.primary_recipients[0]
                ? (result.primary_recipients[0].billing_info
                    ? result.primary_recipients[0].billing_info.email_address
                    : result.primary_recipients[0].email_address)
                : null;
            return {
                source: 'PAYPAL_REST_API',
                confirmed: true,
                id: result.id,
                status: result.status,
                invoice_number: result.detail ? result.detail.invoice_number : null,
                invoice_date: result.detail ? result.detail.invoice_date : null,
                amount,
                currency,
                paid_amount: paidAmount,
                recipient,
                items: result.items ? result.items.map(i => ({
                    name: i.name,
                    quantity: i.quantity,
                    unit_price: i.unit_amount ? parseFloat(i.unit_amount.value) : null,
                    currency: i.unit_amount ? i.unit_amount.currency_code : null
                })) : [],
                transactions
            };
        } catch (err) {
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async listInvoices(status = 'DRAFT', pageSize = 20) {
        this.log(`Listing PayPal invoices (status: ${status})...`);
        try {
            const result = await this.request('GET',
                `/v2/invoicing/invoices?status=${status}&page_size=${pageSize}`
            );
            const invoices = (result.items || []).map(inv => ({
                id: inv.id,
                status: inv.status,
                number: inv.detail ? inv.detail.invoice_number : null,
                amount: inv.total_amount ? parseFloat(inv.total_amount.value) : 0,
                currency: inv.total_amount ? inv.total_amount.currency_code : 'USD',
                recipient: inv.primary_recipients && inv.primary_recipients[0]
                    ? inv.primary_recipients[0].email_address : null
            }));
            this.log(`Found ${invoices.length} invoices`);
            return { source: 'PAYPAL_REST_API', confirmed: true, invoices };
        } catch (err) {
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async getWebhookEvents(since = null) {
        this.log('Fetching PayPal webhook events...');
        const sinceDate = since || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        try {
            const result = await this.request('GET',
                `/v1/notifications/webhooks/events?page_size=50`
            );
            const events = (result.events || []).map(evt => ({
                id: evt.id,
                type: evt.event_type,
                time: evt.create_time,
                resource_type: evt.resource_type,
                summary: evt.summary
            }));
            this.log(`Fetched ${events.length} webhook events`);
            return { source: 'PAYPAL_REST_API', confirmed: true, events };
        } catch (err) {
            return { source: 'PAYPAL_REST_API', confirmed: false, error: err };
        }
    }

    async reconcileWithLedger(ledgerEarnings) {
        this.log('Starting ledger reconciliation against real PayPal data...');
        const realTx = await this.listTransactions();
        if (!realTx.confirmed) {
            return { confirmed: false, error: 'Could not fetch real PayPal transactions' };
        }
        const realIds = new Set(realTx.transactions.map(t => t.id));
        const ledgerIds = ledgerEarnings.map(e => e.paypal_transaction_id).filter(Boolean);
        const matched = ledgerIds.filter(id => realIds.has(id));
        const unmatched = ledgerIds.filter(id => !realIds.has(id));
        const realUnmatched = realTx.transactions.filter(t => !ledgerIds.includes(t.id));

        return {
            source: 'PAYPAL_REST_API',
            confirmed: true,
            timestamp: new Date().toISOString(),
            real_balance: realTx,
            reconciliation: {
                ledger_entries: ledgerEarnings.length,
                real_transactions: realTx.transactions.length,
                matched: matched.length,
                unmatched_ledger: unmatched.length,
                unmatched_real: realUnmatched.length,
                match_rate: `${((matched.length / Math.max(ledgerIds.length, 1)) * 100).toFixed(1)}%`,
                matched_ids: matched,
                unmatched_ledger_ids: unmatched,
                real_income: realTx.transactions
                    .filter(t => t.type === 'T0000' || t.status === 'S')
                    .reduce((sum, t) => sum + t.amount, 0)
            }
        };
    }

    saveTransactions(data) {
        try {
            const existing = fs.existsSync(this.txLog)
                ? JSON.parse(fs.readFileSync(this.txLog, 'utf8'))
                : { history: [] };
            existing.history.push(data);
            fs.writeFileSync(this.txLog, JSON.stringify(existing, null, 2));
        } catch (e) { /* ok */ }
    }
}

module.exports = RealPayPalIntegration;

if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const paypal = new RealPayPalIntegration();
    async function run() {
        console.log('\n=== REAL PAYPAL WET RUN ===\n');
        console.log('1. Fetching real balance...');
        const balance = await paypal.getBalance();
        console.log(JSON.stringify(balance, null, 2));
        console.log('\n2. Fetching real transactions (last 30 days)...');
        const txs = await paypal.listTransactions();
        console.log(JSON.stringify(txs, null, 2));
        console.log('\n3. Listing invoices...');
        const invoices = await paypal.listInvoices();
        console.log(JSON.stringify(invoices, null, 2));
        paypal.saveTransactions({ balance, transactions: txs, invoices, timestamp: new Date().toISOString() });
    }
    run().catch(console.error);
}
