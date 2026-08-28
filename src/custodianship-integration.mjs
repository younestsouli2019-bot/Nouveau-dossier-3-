/**
 * custodianship-integration.mjs
 * ==============================
 * Integration layer — wires the Swarm Custodianship constitution into the
 * existing supervisor.mjs execution loop.
 *
 * This module is imported by supervisor.mjs and runs the custodian loop
 * around every swarm cycle, ensuring every agent adheres to the constitution.
 */

import { runCustodianLoop, scanEnvironment, triageAndFix } from "./swarm/error-triage.mjs";
import { buildSystemPrompt, broadcastElevation, CONSTITUTION_VERSION } from "./swarm/constitution.mjs";

/**
 * Wraps any swarm agent's main function with the custodianship loop.
 * Use this as the entry point for all agent execution.
 *
 * @param {object} opts
 * @param {string} opts.agent_id
 * @param {string} opts.role
 * @param {string} opts.task_description
 * @param {function} opts.execute - async (ctx) => result
 * @param {string[]} opts.scan_scope
 */
export async function runAsCustodian({ agent_id, role, task_description, execute, scan_scope = ["src/", "scripts/", "settlements/"] }) {
  const systemPrompt = buildSystemPrompt(agent_id, role, task_description);
  console.log(`[Custodianship] Agent ${agent_id} initialized with constitution v${CONSTITUTION_VERSION}`);

  const result = await runCustodianLoop({
    agent_id,
    primaryTask: async (scanCtx) => {
      // Pass scan context to the agent's execute function
      return execute({
        ...scanCtx,
        system_prompt: systemPrompt,
        agent_id,
        role,
      });
    },
    scanScope: scan_scope,
  });

  return result;
}

/**
 * Lightweight scan-only mode — for agents that just want to check the
 * environment without running a primary task. Used by the supervisor's
 * heartbeat cycle to catch inherited errors between task cycles.
 */
export async function custodianHeartbeat(agentId, scanScope = ["src/", "scripts/"]) {
  const findings = scanEnvironment(scanScope);
  if (findings.length > 0) {
    console.log(`[CustodianHeartbeat][${agentId}] Found ${findings.length} issue(s) — triaging...`);
    const results = await triageAndFix(findings, agentId);
    const fixed = results.filter(r => r.fixed);
    return {
      agent_id: agentId,
      findings: findings.length,
      fixed: fixed.length,
      remaining: findings.length - fixed.length,
    };
  }
  return { agent_id: agentId, findings: 0, fixed: 0, remaining: 0 };
}

export { CONSTITUTION_VERSION, buildSystemPrompt, broadcastElevation, runCustodianLoop };