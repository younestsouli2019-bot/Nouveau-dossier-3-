import keychain from './keychain.mjs';
import auditLog from './audit.mjs';
import tokenService from './token.mjs';
import mutualTLS from './mtls.mjs';
import didRegistry from './did.mjs';
import anomalyEngine from './anomaly.mjs';
import abacEngine from './abac.mjs';
import incidentResponse from './incident.mjs';
import ownerGuard from './owner-guard.mjs';
import recoveryRecon from './recovery-recon.mjs';
import legalContinuity from './legal-continuity.mjs';

async function initSecurity({ baseDir = null, actor = 'system' } = {}) {
  const opts = baseDir ? { baseDir } : {};
  await keychain.init(opts);
  await auditLog.init(opts);
  await tokenService.init(opts);
  await mutualTLS.init(opts);
  await didRegistry.init(opts);
  await anomalyEngine.init(opts);
  await abacEngine.init();
  await incidentResponse.init(opts);
  await ownerGuard.init();
  await recoveryRecon.init(opts);
  await legalContinuity.init(opts);
  const status = {
    keychain: await keychain.status(),
    audit: await auditLog.status(),
    tokens: await tokenService.status(),
    mtls: { devMode: process.env.SWARM_MTLS_DEV === '1' },
    did: (await didRegistry.listAgents()).length,
    anomaly: await anomalyEngine.status(),
    abac: abacEngine.getPolicy().version,
    incident: await incidentResponse.status(),
    recovery: recoveryRecon.totals(),
    legal: await legalContinuity.status(),
  };
  await auditLog.append({ actor, action: 'SECURITY_INIT', resource: 'stack', result: 'initialized' });
  return status;
}

async function initSecurityStack(opts) {
  return initSecurity(opts);
}

export {
  keychain,
  auditLog,
  tokenService,
  mutualTLS,
  didRegistry,
  anomalyEngine,
  abacEngine,
  incidentResponse,
  ownerGuard,
  recoveryRecon,
  legalContinuity,
  initSecurity,
  initSecurityStack,
};
