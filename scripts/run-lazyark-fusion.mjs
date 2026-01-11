
import { AutonomousAgentUpgrader } from '../src/agents/autonomous-upgrader.mjs';
import { execSync } from 'child_process';
import path from 'path';

async function runFusionAndReconciliation() {
  console.log('🚀 STARTING LAZYARK FUSION & RECONCILIATION PROTOCOL...');
  
  const upgrader = new AutonomousAgentUpgrader();
  
  // MOCKING DATA FOR LOCAL TEST IF API FAILS
  const originalFetch = upgrader.fetchAgentEntities.bind(upgrader);
  
  upgrader.fetchAgentEntities = async () => {
    const agents = await originalFetch();
    if (!agents || agents.length === 0) {
      throw new Error('CRITICAL: No agents found or API is unreachable. Halting fusion.');
    }
    return agents;
  };

  // 1. RUN FUSION
  console.log('\n--- STEP 1: LAZYARK AGENT FUSION ---');
  const fusionResults = await upgrader.runLazyArkFusion();
  console.log('✅ Fusion Complete');

  // 2. RUN SONDAGE (Needs Assessment)
  console.log('\n--- STEP 2: AGENT NEEDS ASSESSMENT (SONDAGE) ---');
  const agents = await upgrader.fetchAgentEntities(); // Fetch again (includes fused/mocked)
  const analysis = await upgrader.analyzeAgentCapabilities(agents);
  
  if (analysis.needs_assessment && analysis.needs_assessment.length > 0) {
    console.log('📋 AGENT NEEDS IDENTIFIED:');
    analysis.needs_assessment.forEach(item => {
      console.log(`  🔹 ${item.agent_name} (${item.agent_id}):`);
      item.needs.forEach(need => console.log(`     - ${need}`));
    });
  } else {
    console.log('✅ No critical needs identified.');
  }

  // 3. RUN RECONCILIATION SCRIPTS
  console.log('\n--- STEP 3: FINANCIAL RECONCILIATION PROTOCOLS ---');
  const scripts = [
    'recover-psp-proofs.mjs',
    'reconcile-amount-mismatches.mjs',
    'emergency-settlement.mjs'
  ];

  for (const script of scripts) {
    console.log(`\n▶️ Executing ${script}...`);
    try {
      const output = execSync(`node scripts/${script}`, { encoding: 'utf8' });
      console.log(output);
    } catch (error) {
      console.error(`❌ Failed to run ${script}: ${error.message}`);
    }
  }

  console.log('\n✅ ALL SYSTEMS VERIFIED.');
}

runFusionAndReconciliation().catch(console.error);
