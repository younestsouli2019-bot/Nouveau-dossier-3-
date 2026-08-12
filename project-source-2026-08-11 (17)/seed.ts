import { db } from './src/lib/db';

async function seed() {
  await db.payoutAuditLog.deleteMany();
  await db.autoPilotRun.deleteMany();
  await db.payoutItem.deleteMany();
  await db.payoutBatch.deleteMany();
  await db.revenueEvent.deleteMany();

  const revenueEvents = [
    { source: "Subscription", amount: 4999.99, currency: "USD", status: "confirmed", description: "Enterprise plan - Acme Corp", referenceId: "REV-2024-001" },
    { source: "Transaction Fee", amount: 1250.50, currency: "USD", status: "confirmed", description: "Marketplace commission - January", referenceId: "REV-2024-002" },
    { source: "Subscription", amount: 3499.00, currency: "USD", status: "confirmed", description: "Pro plan - TechStart Inc", referenceId: "REV-2024-003" },
    { source: "Referral Bonus", amount: 750.00, currency: "USD", status: "confirmed", description: "Partner referral - DataFlow", referenceId: "REV-2024-004" },
    { source: "Transaction Fee", amount: 2100.75, currency: "USD", status: "reconciled", description: "Marketplace commission - February", referenceId: "REV-2024-005" },
    { source: "Subscription", amount: 4999.99, currency: "USD", status: "reconciled", description: "Enterprise plan - Acme Corp (renewal)", referenceId: "REV-2024-006" },
    { source: "Transaction Fee", amount: 1875.25, currency: "USD", status: "reconciled", description: "Marketplace commission - March", referenceId: "REV-2024-007" },
    { source: "Subscription", amount: 1999.00, currency: "USD", status: "pending", description: "Business plan - StartupXYZ", referenceId: "REV-2024-008" },
    { source: "Transaction Fee", amount: 3200.00, currency: "USD", status: "confirmed", description: "Marketplace commission - April", referenceId: "REV-2024-009" },
    { source: "Referral Bonus", amount: 1200.00, currency: "USD", status: "reconciled", description: "Partner referral - CloudSync", referenceId: "REV-2024-010" },
    { source: "Subscription", amount: 4999.99, currency: "USD", status: "confirmed", description: "Enterprise plan - GlobalTech", referenceId: "REV-2024-011" },
    { source: "Transaction Fee", amount: 980.50, currency: "USD", status: "pending", description: "Marketplace commission - May (partial)", referenceId: "REV-2024-012" },
    { source: "Subscription", amount: 2499.00, currency: "USD", status: "reconciled", description: "Pro plan - InnovateLab", referenceId: "REV-2024-013" },
    { source: "Referral Bonus", amount: 550.00, currency: "USD", status: "confirmed", description: "Partner referral - NetPulse", referenceId: "REV-2024-014" },
    { source: "Transaction Fee", amount: 1675.30, currency: "USD", status: "confirmed", description: "Marketplace commission - May", referenceId: "REV-2024-015" },
  ];

  for (const event of revenueEvents) {
    await db.revenueEvent.create({ data: event });
  }

  const batches = [
    {
      batchNumber: "PB-2024-001", totalAmount: 8750.50, currency: "USD", status: "completed",
      itemCount: 4, scheduledDate: new Date("2024-01-15"), processedDate: new Date("2024-01-15"),
      approvedBy: "Sarah Johnson", notes: "January payout cycle",
      items: [
        { recipientName: "Alice Martin", recipientEmail: "alice@partner.com", amount: 2500.00, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-001-A", processedAt: new Date("2024-01-15"), deliveryConfirmed: false },
        { recipientName: "Bob Chen", recipientEmail: "bob@vendor.io", amount: 3250.50, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-001-B", processedAt: new Date("2024-01-15"), deliveryConfirmed: false },
        { recipientName: "Carol Williams", recipientEmail: "carol@affiliate.net", amount: 1500.00, status: "completed", paymentMethod: "paypal", transactionRef: "TXN-001-C", processedAt: new Date("2024-01-15"), deliveryConfirmed: true, deliveryConfirmedAt: new Date("2024-01-16") },
        { recipientName: "David Kim", recipientEmail: "david@service.co", amount: 1500.00, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-001-D", deliveryConfirmed: false },
      ]
    },
    {
      batchNumber: "PB-2024-002", totalAmount: 6200.75, currency: "USD", status: "completed",
      itemCount: 3, scheduledDate: new Date("2024-02-15"), processedDate: new Date("2024-02-16"),
      approvedBy: "Sarah Johnson", notes: "February payout cycle",
      items: [
        { recipientName: "Eve Rodriguez", recipientEmail: "eve@partner.com", amount: 2200.00, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-002-A", processedAt: new Date("2024-02-16"), deliveryConfirmed: false },
        { recipientName: "Frank Patel", recipientEmail: "frank@vendor.io", amount: 2000.75, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-002-B", processedAt: new Date("2024-02-16"), deliveryConfirmed: false },
        { recipientName: "Grace Lee", recipientEmail: "grace@affiliate.net", amount: 2000.00, status: "completed", paymentMethod: "paypal", transactionRef: "TXN-002-C", processedAt: new Date("2024-02-16"), deliveryConfirmed: true, deliveryConfirmedAt: new Date("2024-02-17") },
      ]
    },
    {
      batchNumber: "PB-2024-003", totalAmount: 9875.25, currency: "USD", status: "processing",
      itemCount: 5, scheduledDate: new Date("2024-03-15"), approvedBy: "Michael Brown",
      notes: "March payout cycle - stuck in processing",
      items: [
        { recipientName: "Henry Taylor", recipientEmail: "henry@partner.com", amount: 2750.00, status: "completed", paymentMethod: "bank_transfer", transactionRef: "TXN-003-A", processedAt: new Date("2024-03-15"), deliveryConfirmed: true, deliveryConfirmedAt: new Date("2024-03-16") },
        { recipientName: "Irene Nakamura", recipientEmail: "irene@vendor.io", amount: 2125.25, status: "processing", paymentMethod: "bank_transfer", transactionRef: "TXN-003-B" },
        { recipientName: "Jack Morrison", recipientEmail: "jack@affiliate.net", amount: 1500.00, status: "processing", paymentMethod: "paypal" },
        { recipientName: "Karen Zhang", recipientEmail: "karen@service.co", amount: 2000.00, status: "pending", paymentMethod: "bank_transfer" },
        { recipientName: "Leo Garcia", recipientEmail: "leo@partner.com", amount: 1500.00, status: "pending", paymentMethod: "bank_transfer" },
      ]
    },
    {
      batchNumber: "PB-2024-004", totalAmount: 7450.00, currency: "USD", status: "pending_approval",
      itemCount: 4, scheduledDate: new Date("2024-04-15"),
      notes: "April payout cycle - awaiting finance approval",
      items: [
        { recipientName: "Maria Santos", recipientEmail: "maria@partner.com", amount: 2250.00, status: "pending", paymentMethod: "bank_transfer" },
        { recipientName: "Nathan Wright", recipientEmail: "nathan@vendor.io", amount: 1800.00, status: "pending", paymentMethod: "bank_transfer" },
        { recipientName: "Olivia Brown", recipientEmail: "olivia@affiliate.net", amount: 1400.00, status: "pending", paymentMethod: "paypal" },
        { recipientName: "Peter Anderson", recipientEmail: "peter@service.co", amount: 2000.00, status: "pending", paymentMethod: "bank_transfer" },
      ]
    },
    {
      batchNumber: "PB-2024-005", totalAmount: 4300.00, currency: "USD", status: "approved",
      itemCount: 3, scheduledDate: new Date("2024-04-20"), approvedBy: "Michael Brown",
      notes: "Emergency payout - high priority partners",
      items: [
        { recipientName: "Quinn Davis", recipientEmail: "quinn@urgent.com", amount: 1800.00, status: "pending", paymentMethod: "wire_transfer" },
        { recipientName: "Rachel Thomas", recipientEmail: "rachel@urgent.com", amount: 1500.00, status: "pending", paymentMethod: "wire_transfer" },
        { recipientName: "Sam Wilson", recipientEmail: "sam@urgent.com", amount: 1000.00, status: "failed", paymentMethod: "wire_transfer", failureReason: "Invalid bank account details" },
      ]
    },
    {
      batchNumber: "PB-2024-006", totalAmount: 5200.30, currency: "USD", status: "failed",
      itemCount: 3, scheduledDate: new Date("2024-03-10"),
      notes: "Failed batch - banking partner timeout",
      items: [
        { recipientName: "Tom Harris", recipientEmail: "tom@retry.com", amount: 2000.00, status: "failed", paymentMethod: "bank_transfer", failureReason: "Banking partner timeout" },
        { recipientName: "Uma Sharma", recipientEmail: "uma@retry.com", amount: 1200.30, status: "failed", paymentMethod: "bank_transfer", failureReason: "Banking partner timeout" },
        { recipientName: "Victor Lopez", recipientEmail: "victor@retry.com", amount: 2000.00, status: "failed", paymentMethod: "paypal", failureReason: "PayPal service unavailable" },
      ]
    },
  ];

  for (const batch of batches) {
    const { items, ...batchData } = batch;
    await db.payoutBatch.create({
      data: {
        ...batchData,
        items: { create: items.map((item) => ({ batchNumber: batchData.batchNumber, ...item })) },
      },
    });
  }

  console.log("Seed data created successfully!");
}

seed().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await db.$disconnect(); });