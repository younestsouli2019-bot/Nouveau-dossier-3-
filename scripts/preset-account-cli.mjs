/**
 * preset-account-cli.mjs
 * =======================
 * CLI for managing pre-set owner payout accounts.
 *
 * Usage:
 *   node scripts/preset-account-cli.mjs register --rail=paypal --destination=email@example.com --label="Main PayPal"
 *   node scripts/preset-account-cli.mjs verify --id=preset_paypal_001 --method=manual
 *   node scripts/preset-account-cli.mjs activate --id=preset_paypal_001
 *   node scripts/preset-account-cli.mjs list
 *   node scripts/preset-account-cli.mjs list --rail=wise
 *   node scripts/preset-account-cli.mjs disburse --rail=paypal --amount=500 --settlement=sett_001 --dry-run
 */

import { registerPresetAccount, verifyPresetAccount, activatePresetAccount, listPresetAccounts, getActivePresetAccount } from "../src/finance/PreSetOwnerAccountManager.mjs";
import { disburseToPresetAccount } from "../src/finance/AutoDisbursementEngine.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else if (!args.command) {
      args.command = a;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args.command;

  try {
    switch (cmd) {
      case "register": {
        if (!args.rail || !args.destination) {
          console.error("Usage: register --rail=<rail> --destination=<dest> [--label=<label>] [--currency=USD]");
          process.exit(1);
        }
        const acct = await registerPresetAccount({
          rail: args.rail,
          destination: args.destination,
          label: args.label,
          currency: args.currency || "USD",
          metadata: args.metadata ? JSON.parse(args.metadata) : {},
        });
        console.log("✓ Registered:", JSON.stringify(acct, null, 2));
        break;
      }

      case "verify": {
        if (!args.id) {
          console.error("Usage: verify --id=<accountId> [--method=manual|plaid|stripe_identity]");
          process.exit(1);
        }
        const acct = await verifyPresetAccount(args.id, {
          method: args.method || "manual",
          verifier: args.verifier || "owner",
        });
        console.log("✓ KYC Verified:", JSON.stringify(acct, null, 2));
        break;
      }

      case "activate": {
        if (!args.id) {
          console.error("Usage: activate --id=<accountId>");
          process.exit(1);
        }
        const acct = await activatePresetAccount(args.id);
        console.log("✓ Activated:", JSON.stringify(acct, null, 2));
        break;
      }

      case "list": {
        const accounts = await listPresetAccounts(args.rail || null);
        if (accounts.length === 0) {
          console.log("No pre-set accounts found.");
          console.log("\nRegister one: node scripts/preset-account-cli.mjs register --rail=paypal --destination=your@email.com");
        } else {
          console.log(`\nPre-Set Owner Accounts (${accounts.length}):`);
          console.log("─".repeat(80));
          for (const a of accounts) {
            const status = [
              a.kycVerified ? "✓ KYC" : "✗ KYC",
              a.active ? "● ACTIVE" : "○ inactive",
            ].join(" | ");
            console.log(`  ${a.accountId}`);
            console.log(`    Rail: ${a.rail} | Dest: ${a.destination}`);
            console.log(`    ${status} | Priority: ${a.priority} | Currency: ${a.currency}`);
            if (a.kycVerifiedAt) console.log(`    Verified: ${a.kycVerifiedAt} via ${a.kycMethod}`);
            console.log("");
          }
        }
        break;
      }

      case "disburse": {
        if (!args.rail || !args.amount || !args.settlement) {
          console.error("Usage: disburse --rail=<rail> --amount=<USD> --settlement=<id> [--currency=USD] [--dry-run]");
          process.exit(1);
        }
        const result = await disburseToPresetAccount({
          rail: args.rail,
          amountUsd: parseFloat(args.amount),
          settlementId: args.settlement,
          currency: args.currency || "USD",
          dryRun: args["dry-run"] !== false,
          metadata: args.metadata ? JSON.parse(args.metadata) : {},
        });
        console.log("✓ Disbursement:", JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.log(`Swarm Pre-Set Account CLI

Commands:
  register   Register a new pre-set owner account
  verify     Mark an account as KYC-verified
  activate   Activate an account for auto-payout
  list       List all pre-set accounts
  disburse   Simulate a disbursement to a pre-set account

Examples:
  node scripts/preset-account-cli.mjs register --rail=wise --destination=DE89370400440532013000 --label="Wise IBAN"
  node scripts/preset-account-cli.mjs verify --id=preset_wise_001 --method=plaid
  node scripts/preset-account-cli.mjs activate --id=preset_wise_001
  node scripts/preset-account-cli.mjs list
  node scripts/preset-account-cli.mjs disburse --rail=wise --amount=1500 --settlement=sett_001 --dry-run
`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
    process.exit(1);
  }
}

main();