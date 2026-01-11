import { ExternalPaymentAPI } from '../src/api/external-payment-api.mjs'

async function releaseBatchFromSource() {
  console.log('🚀 RELEASING BATCH_LIVE_1767528254631 FROM SOURCE TO OWNER WALLET...');
  
  const api = new ExternalPaymentAPI()
  await api.initialize()
  
  // Configure the release for the specific batch
  const items = [
    { 
      amount: 850.00, 
      currency: 'USD', 
      recipient_email: 'younestsouli2019@gmail.com', 
      note: 'BATCH_LIVE_1767528254631 - Direct Release to Owner Trust Wallet',
      target_wallet: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
      network: 'BEP20',
      coin: 'USDT'
    }
  ]
  
  console.log('📤 Requesting direct settlement from source...');
  const res = await api.requestAutoSettlement({ 
    payoutBatchId: 'BATCH_LIVE_1767528254631', 
    items, 
    actor: 'OwnerDirectRelease' 
  })
  
  console.log('✅ RELEASE REQUEST SENT!');
  console.log('Response:', JSON.stringify(res, null, 2))
  
  if (res.success) {
    console.log('🎉 SUCCESS: Funds released from source to owner wallet!')
    console.log('📍 Transaction ID:', res.transactionId)
    console.log('💰 Amount:', res.amount, res.currency)
    console.log('📬 Destination:', res.destination)
  } else {
    console.log('⚠️  Release may be pending verification')
    console.log('Status:', res.status)
  }
}

releaseBatchFromSource().catch(e => { 
  console.error('❌ Release failed:', e.message)
  process.exit(1) 
})