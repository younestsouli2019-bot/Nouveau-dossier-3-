/**
 * ATTIJARIWAFA PAYPAL REPATRIATION PIPELINE
 *
 * Connects PayPal revenue to Moroccan bank account.
 * Attijari portal requires manual browser + SMS 2FA.
 * This system: monitors PayPal → prepares wire packets → alerts for manual submit → records confirmation.
 *
 * OWNER BANK: Attijariwafa bank, RIB: 007810000448500030594182
 * PORTAL: https://attijaripaypal.attijariwafa.com/PayPal
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const fs = require('fs');
const path = require('path');

const SETTLEMENT_DIR = path.join(__dirname, '..', 'exports', 'settlement');
const BANK_WIRE_DIR = path.join(__dirname, '..', 'exports', 'bank-wire');
const ATTIJARI_STATE = path.join(SETTLEMENT_DIR, 'attijari-repatriation-state.json');
const ATTIJARI_LOG = path.join(SETTLEMENT_DIR, 'attijari-repatriation.log');

class AttijariRepatriation {
    constructor() {
        this.paypalClientId = process.env.PAYPAL_CLIENT_ID;
        this.paypalSecret = process.env.PAYPAL_CLIENT_SECRET;
        this.ownerEmail = process.env.OWNER_PAYPAL_EMAIL;
        this.accessToken = null;
        this.tokenExpiry = 0;

        this.bank = {
            name: 'Attijariwafa bank',
            rib: process.env.MOROCCAN_BANK_RIB || '007810000448500030594182',
            agency: 'RABAT AGDAL',
            address: '83 AV. FAL OULD OUMEIR',
            holder: 'M TSOULI YOUNES',
            swift: 'BCMAMAMC',
            currency: 'MAD'
        };

        this.settlementPolicy = {
            retentionPercent: 70,
            conversionPercent: 30,
            minRepatriationUSD: 50
        };

        this.state = this.loadState();
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        try {
            fs.mkdirSync(SETTLEMENT_DIR, { recursive: true });
            fs.appendFileSync(ATTIJARI_LOG, line + '\n');
        } catch (e) { /* ok */ }
    }

    loadState() {
        try {
            if (fs.existsSync(ATTIJARI_STATE)) {
                return JSON.parse(fs.readFileSync(ATTIJARI_STATE, 'utf8'));
            }
        } catch (e) { /* ok */ }
        return {
            totalRepatriated: 0,
            pendingPackets: [],
            confirmedTransfers: [],
            lastCheck: null,
            created: new Date().toISOString()
        };
    }

    saveState() {
        try {
            fs.mkdirSync(SETTLEMENT_DIR, { recursive: true });
            fs.writeFileSync(ATTIJARI_STATE, JSON.stringify(this.state, null, 2));
        } catch (e) { /* ok */ }
    }

    // ============================================
    // PAYPAL API
    // ============================================
    async getAccessToken() {
        if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;
        const auth = Buffer.from(`${this.paypalClientId}:${this.paypalSecret}`).toString('base64');
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api-m.paypal.com', path: '/v1/oauth2/token', method: 'POST',
                headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    const json = JSON.parse(d);
                    if (json.access_token) {
                        this.accessToken = json.access_token;
                        this.tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
                        resolve(json.access_token);
                    } else reject(json);
                });
            });
            req.on('error', reject);
            req.write('grant_type=client_credentials');
            req.end();
        });
    }

    async paypalGet(path) {
        const token = await this.getAccessToken();
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api-m.paypal.com', path, method: 'GET',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(d);
                        if (res.statusCode >= 400) reject({ status: res.statusCode, body: json });
                        else resolve(json);
                    } catch (e) { reject({ status: res.statusCode, raw: d }); }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    // ============================================
    // STEP 1: CHECK REAL PAYPAL BALANCE
    // ============================================
    async checkPayPalBalance() {
        this.log('Checking PayPal balance for repatriation...');
        try {
            const result = await this.paypalGet('/v1/reporting/balances');
            const balances = result.balances || [];
            const primary = balances.find(b => b.primary === true) || balances[0];
            const balance = {
                currency: primary ? primary.currency_code : 'USD',
                amount: primary ? parseFloat(primary.balance.value) : 0,
                all: balances.map(b => ({ currency: b.currency_code, value: parseFloat(b.balance.value) }))
            };
            this.log(`  PayPal balance: ${balance.currency} ${balance.amount}`);
            return balance;
        } catch (err) {
            this.log(`  Balance check failed: ${err.body?.message || err.status || 'error'}`);
            return { currency: 'USD', amount: 0, error: err };
        }
    }

    // ============================================
    // STEP 2: CHECK INVOICES FOR PAID STATUS
    // ============================================
    async checkPaidInvoices() {
        this.log('Checking for newly paid invoices...');
        try {
            const result = await this.paypalGet('/v2/invoicing/invoices?page_size=50');
            const invoices = (result.items || []).map(inv => {
                const amt = inv.amount || {};
                const recip = inv.primary_recipients && inv.primary_recipients[0];
                return {
                    id: inv.id,
                    status: inv.status,
                    amount: parseFloat(amt.value || '0'),
                    currency: amt.currency_code || 'USD',
                    number: inv.detail?.invoice_number,
                    date: inv.detail?.invoice_date,
                    recipient: recip?.billing_info?.email_address || recip?.email_address || null,
                    paid_amount: inv.payments?.paid_amount ? parseFloat(inv.payments.paid_amount.value) : null
                };
            });

            const paid = invoices.filter(i => i.status === 'PAID');
            const pending = invoices.filter(i => i.status === 'SENT' || i.status === 'DRAFT');
            const totalPaid = paid.reduce((sum, i) => sum + (i.paid_amount || i.amount || 0), 0);

            this.log(`  Found ${paid.length} PAID, ${pending.length} SENT/DRAFT, total paid: ${totalPaid}`);

            return { paid, pending, totalPaid, all: invoices };
        } catch (err) {
            this.log(`  Invoice check failed: ${JSON.stringify(err.body?.message || err.message || err)}`);
            return { paid: [], pending: [], totalPaid: 0, error: err };
        }
    }

    // ============================================
    // STEP 3: GENERATE ATTIJARI WIRE PACKET
    // ============================================
    generateWirePacket(amount, currency, reference) {
        const batchId = `ATTIJARI_${Date.now()}`;
        const splitAmount = amount * (this.settlementPolicy.conversionPercent / 100);
        const retentionAmount = amount * (this.settlementPolicy.retentionPercent / 100);

        const packet = {
            type: 'attijari_manual_wire_packet',
            provider: 'ATTIJARIWAFA_BANK',
            batch_id: batchId,
            portal_url: 'https://attijaripaypal.attijariwafa.com/PayPal',
            amount: amount,
            currency: currency,
            reference: reference || `REPAT-${Date.now()}`,
            settlement_split: {
                retention_compte_devises: retentionAmount,
                conversion_compte_dirhams: splitAmount,
                policy: `${this.settlementPolicy.retentionPercent}% retention / ${this.settlementPolicy.conversionPercent}% conversion`
            },
            beneficiary: this.bank,
            created_at: new Date().toISOString(),
            expected_confirmation_by: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            steps: [
                '1. Open https://attijaripaypal.attijariwafa.com/PayPal',
                '2. Login with Attijariwafa credentials',
                '3. Enter SMS code sent to registered phone',
                '4. Select "Retirer des fonds" (Withdraw funds)',
                '5. Enter amount: ' + amount + ' ' + currency,
                '6. Select account: ' + this.bank.agency,
                '7. Confirm transfer',
                '8. Save transaction reference'
            ],
            confirmation_command: `node swarm-wa/real-autonomous-revenue.js --confirm --batch ${batchId} --tx-id <ATTIJARI_TX_REF>`
        };

        // Save packet
        try {
            fs.mkdirSync(BANK_WIRE_DIR, { recursive: true });
            const packetPath = path.join(BANK_WIRE_DIR, `attijari_wire_${batchId}.json`);
            fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2));
            this.log(`  Wire packet saved: ${packetPath}`);
        } catch (e) { /* ok */ }

        // Update state
        this.state.pendingPackets.push({
            batchId,
            amount,
            currency,
            reference,
            createdAt: new Date().toISOString()
        });
        this.saveState();

        return packet;
    }

    // ============================================
    // STEP 4: CONFIRM WIRE TRANSFER
    // ============================================
    confirmTransfer(batchId, transactionId, receiptUrl) {
        this.log(`Confirming wire transfer: ${batchId} → ${transactionId}`);

        const confirmation = {
            type: 'attijari_wire_receipt',
            provider: 'ATTIJARIWAFA_BANK',
            batch_id: batchId,
            transaction_id: transactionId,
            status: 'confirmed',
            submitted_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
            receipt_url: receiptUrl || ''
        };

        // Save receipt
        try {
            fs.mkdirSync(BANK_WIRE_DIR, { recursive: true });
            const receiptPath = path.join(BANK_WIRE_DIR, `attijari_receipt_${batchId}.json`);
            fs.writeFileSync(receiptPath, JSON.stringify(confirmation, null, 2));
        } catch (e) { /* ok */ }

        // Update state
        this.state.pendingPackets = this.state.pendingPackets.filter(p => p.batchId !== batchId);
        this.state.confirmedTransfers.push({
            batchId,
            transactionId,
            confirmedAt: new Date().toISOString()
        });
        this.saveState();

        this.log(`  ✓ Transfer confirmed: ${batchId}`);
        return confirmation;
    }

    // ============================================
    // FULL REPATRIATION CYCLE
    // ============================================
    async runRepatriationCycle() {
        this.log('═══════════════════════════════════════════════════════════════');
        this.log('  ATTIJARIWAFA REPATRIATION CYCLE');
        this.log('  PayPal → Moroccan Bank Account');
        this.log('═══════════════════════════════════════════════════════════════');

        // Step 1: Check balance
        const balance = await this.checkPayPalBalance();

        // Step 2: Check paid invoices
        const invoices = await this.checkPaidInvoices();

        // Step 3: Determine if repatriation needed
        const repatriableAmount = balance.amount;
        const needsRepatriation = repatriableAmount >= this.settlementPolicy.minRepatriationUSD;

        let wirePacket = null;
        if (needsRepatriation) {
            this.log(`\n  REPATRIATION TRIGGERED: ${balance.currency} ${repatriableAmount}`);
            this.log(`  Split: ${this.settlementPolicy.retentionPercent}% retention / ${this.settlementPolicy.conversionPercent}% conversion`);

            wirePacket = this.generateWirePacket(
                repatriableAmount,
                balance.currency,
                `PayPal repatriation - ${new Date().toISOString().split('T')[0]}`
            );

            this.log(`\n  ═══ ACTION REQUIRED ═══`);
            this.log(`  Wire packet generated: ${wirePacket.batch_id}`);
            this.log(`  Amount: ${repatriableAmount} ${balance.currency}`);
            this.log(`  Portal: ${wirePacket.portal_url}`);
            this.log(`  Steps:`);
            wirePacket.steps.forEach(s => this.log(`    ${s}`));
        } else {
            this.log(`\n  Balance below minimum: ${balance.currency} ${repatriableAmount} < ${this.settlementPolicy.minRepatriationUSD}`);
            this.log(`  No repatriation needed.`);
        }

        const summary = {
            timestamp: new Date().toISOString(),
            paypal_balance: balance,
            paid_invoices: invoices.paid.length,
            total_paid: invoices.totalPaid,
            pending_invoices: invoices.pending.length,
            needs_repatriation: needsRepatriation,
            wire_packet: wirePacket ? wirePacket.batch_id : null,
            wire_amount: wirePacket ? wirePacket.amount : 0,
            state: {
                total_repatriated: this.state.totalRepatriated,
                pending: this.state.pendingPackets.length,
                confirmed: this.state.confirmedTransfers.length
            }
        };

        this.log('\n═══════════════════════════════════════════════════════════════');
        this.log('  CYCLE COMPLETE');
        this.log(`  Balance: ${balance.currency} ${balance.amount}`);
        this.log(`  Paid invoices: ${invoices.paid.length}`);
        this.log(`  Wire packet: ${wirePacket ? 'GENERATED' : 'NOT NEEDED'}`);
        this.log('═══════════════════════════════════════════════════════════════');

        this.state.lastCheck = new Date().toISOString();
        this.saveState();

        return summary;
    }
}

module.exports = AttijariRepatriation;

if (require.main === module) {
    const attijari = new AttijariRepatriation();
    const args = process.argv.slice(2);

    if (args.includes('--confirm')) {
        const batchIdx = args.indexOf('--batch');
        const txIdx = args.indexOf('--tx-id');
        const batchId = batchIdx >= 0 ? args[batchIdx + 1] : null;
        const txId = txIdx >= 0 ? args[txIdx + 1] : null;
        if (!batchId || !txId) {
            console.error('Usage: --confirm --batch <BATCH_ID> --tx-id <TRANSACTION_ID>');
            process.exit(1);
        }
        const result = attijari.confirmTransfer(batchId, txId);
        console.log(JSON.stringify(result, null, 2));
    } else {
        attijari.runRepatriationCycle().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e));
    }
}
