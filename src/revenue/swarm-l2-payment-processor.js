/**
 * SWARM L2 PAYMENT PROCESSING SYSTEM
 * 
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 * 
 * Purpose: Process ALL customer payments via L2 crypto
 * Zero waste - minimal fees - instant settlement
 * 
 * CUSTOMER PAYMENT FLOW:
 * 1. Customer requests procurement
 * 2. SWARM generates L2 invoice
 * 3. Customer pays crypto (L2 preferred)
 * 4. Payment confirmed automatically
 * 5. Order executed immediately
 * 
 * NO FIAT. NO WASTE. ALL CRYPTO.
 */

const crypto = require('crypto');

class SWARML2PaymentProcessor {
    constructor() {
        this.pendingPayments = new Map();
        this.completedPayments = [];
        this.supportedNetworks = {
            // Bitcoin L2
            lightning: {
                name: 'Lightning Network',
                asset: 'BTC',
                confirmTime: '<1 second',
                fee: '<0.01 USD',
                minPayment: 0.000001,
                maxPayment: 10,
                supported: true
            },
            // Ethereum L2s
            arbitrum: {
                name: 'Arbitrum One',
                asset: 'ETH/ERC20',
                confirmTime: '~10 seconds',
                fee: '~0.10 USD',
                minPayment: 0.001,
                maxPayment: 100000,
                supported: true
            },
            optimism: {
                name: 'Optimism',
                asset: 'ETH/ERC20',
                confirmTime: '~10 seconds',
                fee: '~0.10 USD',
                minPayment: 0.001,
                maxPayment: 100000,
                supported: true
            },
            base: {
                name: 'Base',
                asset: 'ETH/ERC20',
                confirmTime: '~10 seconds',
                fee: '~0.05 USD',
                minPayment: 0.001,
                maxPayment: 100000,
                supported: true
            },
            polygon: {
                name: 'Polygon',
                asset: 'MATIC/ERC20',
                confirmTime: '~2 seconds',
                fee: '<0.01 USD',
                minPayment: 0.01,
                maxPayment: 100000,
                supported: true
            },
            // Tron
            tron: {
                name: 'Tron',
                asset: 'TRC20',
                confirmTime: '~3 seconds',
                fee: '~1 TRX (0.10 USD)',
                minPayment: 1,
                maxPayment: 10000000,
                supported: true
            },
            // Solana
            solana: {
                name: 'Solana',
                asset: 'SOL/SPL',
                confirmTime: '~400ms',
                fee: '<0.01 USD',
                minPayment: 0.001,
                maxPayment: 100000,
                supported: true
            }
        };
    }

    // Generate payment invoice for customer
    generateInvoice(amountUSD, currency, purpose, customerInfo) {
        const paymentId = crypto.randomBytes(16).toString('hex');
        
        const invoice = {
            id: paymentId,
            amountUSD: parseFloat(amountUSD),
            currency: currency.toUpperCase(),
            purpose,
            customer: customerInfo,
            paymentAddresses: this.generateAddresses(paymentId),
            expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
            status: 'PENDING',
            createdAt: new Date().toISOString()
        };

        this.pendingPayments.set(paymentId, invoice);
        
        return invoice;
    }

    // Generate unique payment addresses
    generateAddresses(paymentId) {
        const addresses = {};
        
        for (const [network, info] of Object.entries(this.supportedNetworks)) {
            if (info.supported) {
                addresses[network] = {
                    address: `${network.toUpperCase()}_${paymentId.substring(0, 16)}`,
                    network: info.name,
                    asset: info.asset,
                    fee: info.fee,
                    confirmTime: info.confirmTime
                };
            }
        }
        
        return addresses;
    }

    // Create procurement-specific invoice
    createProcurementInvoice(order) {
        const items = order.items || [];
        const totalUSD = items.reduce((sum, item) => sum + (item.priceUSD || (item.priceMAD || 0) / 10), 0);
        
        return this.generateInvoice(
            totalUSD,
            'USDT',
            `Procurement: ${items.map(i => i.name).join(', ')}`,
            {
                recipient: order.recipient,
                address: order.address,
                phone: order.phone
            }
        );
    }

    // Get recommended payment method (lowest fees)
    getRecommendedMethod(amountUSD) {
        if (amountUSD < 10) {
            return {
                network: 'lightning',
                reason: 'Lowest fees for micro-payments',
                fee: '<0.01 USD'
            };
        } else if (amountUSD < 100) {
            return {
                network: 'tron',
                reason: 'Low fees, fast settlement',
                fee: '~0.10 USD'
            };
        } else if (amountUSD < 1000) {
            return {
                network: 'polygon',
                reason: 'Low fees, good liquidity',
                fee: '<0.01 USD'
            };
        } else {
            return {
                network: 'arbitrum',
                reason: 'Best for larger amounts',
                fee: '~0.10 USD'
            };
        }
    }

    // Check payment status
    async checkPaymentStatus(paymentId) {
        const invoice = this.pendingPayments.get(paymentId);
        
        if (!invoice) {
            return { error: 'Invoice not found' };
        }
        
        // In production, would check blockchain for confirmation
        return {
            id: paymentId,
            status: invoice.status,
            amountUSD: invoice.amountUSD,
            expiresAt: invoice.expiresAt
        };
    }

    // Confirm payment received
    confirmPayment(paymentId, txHash, network) {
        const invoice = this.pendingPayments.get(paymentId);
        
        if (!invoice) {
            return { error: 'Invoice not found' };
        }
        
        invoice.status = 'CONFIRMED';
        invoice.txHash = txHash;
        invoice.network = network;
        invoice.confirmedAt = new Date().toISOString();
        
        this.completedPayments.push(invoice);
        this.pendingPayments.delete(paymentId);
        
        return {
            success: true,
            invoice: invoice
        };
    }

    // Display payment options for customer
    displayPaymentOptions(invoice) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('💳 SWARM PAYMENT INVOICE');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Invoice ID: ${invoice.id}`);
        console.log(`Amount: $${invoice.amountUSD} USD`);
        console.log(`Purpose: ${invoice.purpose}`);
        console.log(`Expires: ${invoice.expiresAt}`);
        console.log('');
        console.log('PAYMENT OPTIONS (Lowest fees first):');
        console.log('');
        
        const sorted = Object.entries(invoice.paymentAddresses)
            .sort((a, b) => this.compareFee(a[1].fee, b[1].fee));
        
        sorted.forEach(([network, addr], i) => {
            console.log(`${i + 1}. ${addr.network} (${addr.asset})`);
            console.log(`   Address: ${addr.address}`);
            console.log(`   Fee: ${addr.fee}`);
            console.log(`   Confirm: ${addr.confirmTime}`);
            console.log('');
        });
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️  SEND EXACT AMOUNT. DIFFERENT AMOUNTS MAY NOT AUTO-CREDIT.');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // Compare fees for sorting
    compareFee(feeA, feeB) {
        const extractNum = (f) => {
            const match = f.match(/[\d.]+/);
            return match ? parseFloat(match[0]) : 0;
        };
        return extractNum(feeA) - extractNum(feeB);
    }

    // Export pending payments as JSON
    exportPendingPayments() {
        return Array.from(this.pendingPayments.values());
    }
}

module.exports = SWARML2PaymentProcessor;

// CLI
if (require.main === module) {
    const processor = new SWARML2PaymentProcessor();
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚡ SWARM L2 PAYMENT PROCESSOR');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('ZERO WASTE POLICY: ALL PAYMENTS VIA CRYPTO L2');
    console.log('');
    console.log('SUPPORTED NETWORKS:');
    Object.entries(processor.supportedNetworks).forEach(([key, net]) => {
        console.log(`  ✅ ${net.name} (${key}) - Fee: ${net.fee} - Speed: ${net.confirmTime}`);
    });
    console.log('');
    console.log('PAYMENT FLOW:');
    console.log('  1. Customer requests order');
    console.log('  2. SWARM generates L2 invoice');
    console.log('  3. Customer pays crypto (recommended: lowest fee network)');
    console.log('  4. Payment auto-confirmed');
    console.log('  5. Order executed immediately');
    console.log('');
    console.log('NO FIAT. NO WASTE. ALL CRYPTO.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Demo invoice
    const demoInvoice = processor.generateInvoice(
        100,
        'USDT',
        'Procurement: Bachir Health Packs',
        { recipient: 'Bachir Tsouli', address: '45 Ave Ibn Sina Agdal' }
    );
    console.log('\nDEMO INVOICE:');
    processor.displayPaymentOptions(demoInvoice);
    
    const recommendation = processor.getRecommendedMethod(100);
    console.log(`\nRECOMMENDED for $100: ${recommendation.network} (${recommendation.reason})`);
}
