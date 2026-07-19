/**
 * Provider factory — creates the correct provider for each L2 network.
 * All providers share the BaseL2Provider interface.
 */

import { BaseL2Provider } from './BaseL2Provider.js';

export class ArbitrumProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

export class OptimismProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

export class BaseProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

export class PolygonZkEvmProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

export class LineaProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

export class ScrollProvider extends BaseL2Provider {
  constructor(config, options) {
    super(config, options);
  }
}

// ── Factory ──

const PROVIDER_MAP = {
  arbitrum: ArbitrumProvider,
  optimism: OptimismProvider,
  base: BaseProvider,
  'polygon-zkevm': PolygonZkEvmProvider,
  linea: LineaProvider,
  scroll: ScrollProvider,
};

/**
 * Create a provider instance for the given network key.
 */
export function createProvider(networkKey, networkConfig, options = {}) {
  const ProviderClass = PROVIDER_MAP[networkKey];
  if (!ProviderClass) {
    throw new Error(`Unknown L2 network: ${networkKey}`);
  }
  return new ProviderClass(networkConfig, options);
}

/**
 * Create providers for all enabled networks.
 * Returns { networkKey: providerInstance }
 */
export function createAllProviders(config) {
  const providers = {};
  const options = {
    maxConcurrent: config.maxConcurrentRequests,
    timeout: config.rpcTimeout,
  };

  for (const key of config.enabledNetworkKeys) {
    const netConfig = config.networks[key];
    if (netConfig.enabled) {
      providers[key] = createProvider(key, netConfig, options);
    }
  }

  return providers;
}
