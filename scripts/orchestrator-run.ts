import { executePass } from '../src/lib/orchestrator/run';

const apply = process.argv.includes('--apply');
const record = await executePass({ trigger: process.env.ORCHESTRATOR_TRIGGER || 'cli', apply });

if (process.argv.includes('--json')) console.log(JSON.stringify(record, null, 2));
else console.log(`[orchestrator] ${record.status} in ${record.durationMs}ms — ${record.checks.map((c) => `${c.name}=${c.status}`).join(' ')}`);

process.exit(record.status === 'ok' ? 0 : record.status === 'degraded' ? 1 : record.status === 'skipped' ? 3 : 2);
