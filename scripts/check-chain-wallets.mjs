import { checkAllChains } from '../src/mcp/chain-wallet-monitor.mjs';

const result = await checkAllChains();
console.log(JSON.stringify(result, null, 2));
