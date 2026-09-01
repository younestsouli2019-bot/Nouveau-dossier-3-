// Runs the phantom-completed quarantine sweep against the LIVE DB using the
// RELAXED (OWNER 2026-09-01) physical-delivery gates. Financial fail-closed intact.
import 'dotenv/config';
import { runPhantomCompletedQuarantineSweep } from '../src/lib/strict-enforcement/phantom-quarantine.mjs';

const res = await runPhantomCompletedQuarantineSweep({});
console.log(JSON.stringify(res, null, 2));
process.exit(0);
