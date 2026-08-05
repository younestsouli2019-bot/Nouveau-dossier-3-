import procurementAgent, { ProcurementAgent } from './procurement.mjs';
import supplierRegistry, { SupplierRegistry } from './supplier-registry.mjs';

async function initProcurement(opts = {}) {
  await supplierRegistry.init(opts);
  await procurementAgent.init(opts);
  return { procurementAgent, supplierRegistry };
}

export { procurementAgent, supplierRegistry, ProcurementAgent, SupplierRegistry, initProcurement };
