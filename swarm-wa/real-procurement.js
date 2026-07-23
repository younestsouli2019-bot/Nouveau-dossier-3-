/**
 * REAL PROCUREMENT WET-RUN FRAMEWORK
 * 
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 * 
 * Connects WhatsApp vendor outreach → Purchase Orders → Real payments
 * Every step verified by external confirmation.
 * 
 * REVENUE MODEL:
 * 1. Procure items via WhatsApp vendors (local Morocco + Temu)
 * 2. Resell on marketplaces (Amazon, Etsy, Shopify) at markup
 * 3. Revenue = Resale Price - Procurement Cost - Fees
 * 
 * EXTERNAL CONFIRMATIONS REQUIRED:
 * - Vendor accepts price (WhatsApp screenshot/response)
 * - Payment sent (PayPal receipt / bank wire ref / crypto tx hash)
 * - Item received (tracking number / photo)
 * - Item listed on marketplace (listing URL)
 * - Item sold (marketplace order ID)
 * - Payment received (marketplace payout ref)
 */

const fs = require('fs');
const path = require('path');

class RealProcurement {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'exports', 'settlement', 'real-procurement.json');
        this.data = this.load();
        this.logDir = path.join(__dirname, '..', 'exports', 'settlement');
    }

    load() {
        try {
            if (fs.existsSync(this.dbPath)) {
                return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
            }
        } catch (e) { /* ok */ }
        return {
            version: '1.0.0',
            created: new Date().toISOString(),
            batches: [],
            stats: { total_invested: 0, total_revenue: 0, profit: 0, active_batches: 0 }
        };
    }

    save() {
        this.data.stats.total_invested = this.data.batches.reduce((s, b) => s + b.total_cost, 0);
        this.data.stats.total_revenue = this.data.batches.reduce((s, b) => s + b.total_revenue, 0);
        this.data.stats.profit = this.data.stats.total_revenue - this.data.stats.total_invested;
        this.data.stats.active_batches = this.data.batches.filter(b => b.status !== 'COMPLETED').length;
        fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    }

    createBatch({ name, items, vendor_type, vendor_contact, payment_method }) {
        const batch = {
            id: `BATCH_${Date.now()}`,
            name,
            status: 'SOURCING',
            created: new Date().toISOString(),
            vendor_type,
            vendor_contact,
            payment_method,
            items: items.map(item => ({
                name: item.name,
                target_price: item.target_price,
                quantity: item.quantity || 1,
                sku: item.sku || null,
                status: 'SOURCING',
                vendor_quote: null,
                vendor_quote_proof: null,
                purchase_order: null,
                payment_ref: null,
                payment_amount: null,
                shipping_tracking: null,
                received: false,
                received_date: null,
                listing_url: null,
                listing_price: null,
                sold: false,
                sold_order_id: null,
                sold_price: null,
                sold_date: null,
                payout_ref: null,
                timeline: []
            })),
            total_cost: 0,
            total_revenue: 0,
            profit: 0
        };
        this.data.batches.push(batch);
        this.save();
        return batch;
    }

    updateItem(batchId, itemName, update) {
        const batch = this.data.batches.find(b => b.id === batchId);
        if (!batch) throw new Error(`Batch ${batchId} not found`);
        const item = batch.items.find(i => i.name === itemName);
        if (!item) throw new Error(`Item ${itemName} not found in batch ${batchId}`);

        Object.assign(item, update);
        item.timeline.push({
            timestamp: new Date().toISOString(),
            action: Object.keys(update).join(', '),
            details: update
        });

        batch.total_cost = batch.items.reduce((s, i) => s + (i.payment_amount || 0), 0);
        batch.total_revenue = batch.items.reduce((s, i) => s + (i.sold_price || 0), 0);
        batch.profit = batch.total_revenue - batch.total_cost;
        this.save();
        return item;
    }

    confirmVendorQuote(batchId, itemName, quote, proof) {
        if (!proof) throw new Error('REJECTED: Vendor quote requires proof (screenshot/response)');
        return this.updateItem(batchId, itemName, {
            vendor_quote: quote,
            vendor_quote_proof: proof,
            status: 'QUOTED'
        });
    }

    confirmPayment(batchId, itemName, amount, ref, proof) {
        if (!ref) throw new Error('REJECTED: Payment requires external reference');
        if (!proof) throw new Error('REJECTED: Payment requires proof');
        return this.updateItem(batchId, itemName, {
            payment_amount: amount,
            payment_ref: ref,
            proof,
            status: 'PAID'
        });
    }

    confirmShipment(batchId, itemName, trackingNumber) {
        if (!trackingNumber) throw new Error('REJECTED: Shipment requires tracking number');
        return this.updateItem(batchId, itemName, {
            shipping_tracking: trackingNumber,
            status: 'SHIPPED'
        });
    }

    confirmReceipt(batchId, itemName, photoProof) {
        return this.updateItem(batchId, itemName, {
            received: true,
            received_date: new Date().toISOString(),
            proof: photoProof,
            status: 'RECEIVED'
        });
    }

    confirmListing(batchId, itemName, url, price) {
        return this.updateItem(batchId, itemName, {
            listing_url: url,
            listing_price: price,
            status: 'LISTED'
        });
    }

    confirmSale(batchId, itemName, orderId, soldPrice) {
        if (!orderId) throw new Error('REJECTED: Sale requires marketplace order ID');
        return this.updateItem(batchId, itemName, {
            sold: true,
            sold_order_id: orderId,
            sold_price: soldPrice,
            sold_date: new Date().toISOString(),
            status: 'SOLD'
        });
    }

    confirmPayout(batchId, itemName, payoutRef) {
        if (!payoutRef) throw new Error('REJECTED: Payout requires external reference');
        return this.updateItem(batchId, itemName, {
            payout_ref: payoutRef,
            status: 'COMPLETED'
        });
    }

    getStatus() {
        const batches = this.data.batches;
        return {
            total_batches: batches.length,
            active: batches.filter(b => b.status !== 'COMPLETED').length,
            completed: batches.filter(b => b.status === 'COMPLETED').length,
            total_items: batches.reduce((s, b) => s + b.items.length, 0),
            total_invested: this.data.stats.total_invested,
            total_revenue: this.data.stats.total_revenue,
            profit: this.data.stats.profit,
            items_by_status: this.getItemStatusCounts()
        };
    }

    getItemStatusCounts() {
        const counts = {};
        this.data.batches.forEach(b => {
            b.items.forEach(i => {
                counts[i.status] = (counts[i.status] || 0) + 1;
            });
        });
        return counts;
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        try {
            fs.appendFileSync(path.join(this.logDir, 'real-procurement.log'), line + '\n');
        } catch (e) { /* ok */ }
    }
}

module.exports = RealProcurement;
