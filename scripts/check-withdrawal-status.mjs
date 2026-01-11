import { ExternalPaymentAPI } from '../src/api/external-payment-api.mjs'

async function checkWithdrawalStatus() {
  console.log('🔍 CHECKING WITHDRAWAL STATUS FOR BATCH_LIVE_1767528254631...')
  
  try {
    const api = new ExternalPaymentAPI()
    await api.initialize()
    
    // Check the status of the withdrawal
    const status = await api.fm.gateway.getWithdrawalStatus({
      provider: 'binance',
      address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
      amount: 850
    })
    
    console.log('📊 Withdrawal Status:')
    console.log('Status:', status.status)
    console.log('Provider:', status.provider)
    console.log('Transaction ID:', status.txId || 'Not available')
    console.log('Network:', status.network)
    
    if (status.txId) {
      console.log('🔗 View on blockchain: https://bscscan.com/tx/' + status.txId)
    }
    
    if (status.status === 'completed') {
      console.log('✅ WITHDRAWAL COMPLETED SUCCESSFULLY!')
      console.log('💰 850 USDT has been transferred to the owner wallet.')
      console.log('🎉 BATCH_LIVE_1767528254631 funds have been released from source!')
    } else if (status.status === 'processing') {
      console.log('⏳ Withdrawal is still processing...')
      console.log('💡 Please check again in a few minutes.')
    } else if (status.status === 'submitted') {
      console.log('📤 Withdrawal has been submitted to the network...')
      console.log('💡 Transaction is pending confirmation.')
    } else {
      console.log('⚠️  Withdrawal status:', status.status)
      if (status.error) console.log('Error:', status.error)
    }
    
  } catch (error) {
    console.error('❌ Failed to check withdrawal status:', error.message)
  }
}

checkWithdrawalStatus()