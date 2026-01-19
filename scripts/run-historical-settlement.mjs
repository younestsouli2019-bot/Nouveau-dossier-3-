#!/usr/bin/env node

import { settleHistoricalRevenues } from './settle-historical-revenues.mjs';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log('\n🏦 HISTORICAL REVENUE SETTLEMENT WORKFLOW\n');
  
  console.log('This will:');
  console.log('1. Scan RevenueEvent_export for "earned" events without payout_batch_id');
  console.log('2. Apply constitutional checks (no scams, legal compliance)');
  console.log('3. Generate Payoneer CSV/XLS files for manual upload');
  console.log('4. Update ledger with settlement records\n');
  
  rl.question('Continue? (y/N) ', async (answer) => {
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      rl.close();
      return;
    }
    
    console.log('\n🔄 Processing...\n');
    
    // We can't easily capture the return value in the same way as the script because the script exits process.
    // Instead, we should modify the script to not exit if imported, or just run the logic directly.
    // The previous script checks `import.meta.url === file://...` so it won't auto-run on import.
    // We can call the exported function.
    
    try {
        const result = await settleHistoricalRevenues();
        
        if (result.settled) {
          console.log('\n✅ Success! Files ready for Payoneer upload.');
        } else if (result.reason === 'REQUIRES_HUMAN_APPROVAL') {
          console.log('\n⚠️  Approval required (amount > $5000).');
          console.log(`   Review files in: ${result.review_files.manifest}`);
          
          rl.question('\nApprove this settlement? (y/N) ', async (approval) => {
            if (approval.toLowerCase() === 'y') {
              console.log('🔓 Executing approved settlement...');
              // Re-run with approval flag logic - we need to pass a flag or just bypass.
              // Since we are calling the function directly, we can't easily pass argv.
              // Let's modify the function to accept an options object or just rely on the fact 
              // that the first run generated the files, and the user can now manually "approve" 
              // by running the command with --approve flag if they were using CLI.
              
              // But here we are in a wrapper. 
              // Ideally `settleHistoricalRevenues` should take an argument `approved: boolean`.
              // But I implemented it to check process.argv.
              // Let's push to process.argv for the second run.
              process.argv.push('--approve');
              await settleHistoricalRevenues();
            } else {
              console.log('Settlement held for review.');
            }
            rl.close();
          });
          return; // Don't close rl yet
        } else {
          console.log(`\n❌ Failed: ${result.reason}`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
    rl.close();
  });
}

main();
