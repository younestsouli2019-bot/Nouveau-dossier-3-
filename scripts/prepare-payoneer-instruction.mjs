import { InstructionGateway } from '../src/financial/gateways/InstructionGateway.mjs';
import { parseArgs } from '../src/utils/cli.mjs';

function getEnv(name, fallback = null) {
  const v = process.env[name];
  return v == null || String(v).trim() === '' ? fallback : v;
}

function ms() {
  return Date.now();
}

function normalizeCurrency(v, fallback = 'USD') {
  const s = String(v || '').trim().toUpperCase();
  return s && s.length === 3 ? s : fallback;
}

async function main() {
  const args = parseArgs(process.argv);
  const amount = Number(args.amount || args.a || '0');
  const currency = normalizeCurrency(args.currency || args.ccy || getEnv('DEFAULT_CURRENCY', 'USD'));
  const recipient = String(args.recipient || args.to || getEnv('OWNER_PAYONEER_EMAIL') || getEnv('PAYONEER_EMAIL') || '').trim();
  const note = String(args.note || args.n || `Payoneer Standard Request ${new Date().toISOString().slice(0, 10)}`).trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'invalid_amount' })}\n`);
    process.exitCode = 1;
    return;
  }
  if (!recipient || !recipient.includes('@')) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'missing_recipient_email' })}\n`);
    process.exitCode = 1;
    return;
  }

  const gateway = new InstructionGateway();
  const transactions = [
    {
      amount: Number(amount.toFixed(2)),
      currency,
      destination: recipient,
      reference: note
    }
  ];

  const payload = {
    provider: 'payoneer',
    title: 'Instruction for Payoneer Standard',
    created_at: new Date().toISOString(),
    transactions,
    meta: {
      mode: 'standard_account',
      steps: [
        'Login to Payoneer',
        'Use Request a Payment',
        'Set recipient to owner email',
        'Enter amount and currency',
        'Attach note/reference',
        'Submit and export confirmation'
      ],
      reassurance: 'No API required; uses standard account flow'
    }
  };

  const res = await gateway.create(payload, { dir: 'settlements/instructions', prefix: `instruction_payoneer_standard_${ms()}` });
  process.stdout.write(`${JSON.stringify({ ok: true, status: res.status, filePath: res.filePath })}\n`);
}

main().catch((e) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: e?.message || String(e) })}\n`);
  process.exitCode = 1;
});
