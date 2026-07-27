#!/usr/bin/env node
import recoveryEngine from './src/recovery.mjs';

const command = process.argv[2] || 'health';

async function main() {
  await recoveryEngine.init();

  switch (command) {
    case 'health': {
      const health = await recoveryEngine.healthCheck();
      console.log(JSON.stringify(health, null, 2));
      process.exit(health.healthy ? 0 : 1);
      break;
    }
    case 'reset': {
      const result = await recoveryEngine.resetErrorStorm();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'payoneer': {
      const result = await recoveryEngine.recoverPayoneerBatches();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'migrate': {
      const result = await recoveryEngine.migrateMemoryState();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'full': {
      const result = await recoveryEngine.fullRecovery();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.health.healthy ? 0 : 1);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: node recover.mjs [health|reset|payoneer|migrate|full]');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Recovery failed:', err);
  process.exit(1);
});
