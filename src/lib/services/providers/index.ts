/**
 * Phase 5E Stage 2: Payment Provider Adapters
 *
 * Re-exports all provider adapters and registers them with the provider registry.
 * Import this module to ensure providers are registered before use.
 */

export { paystackProvider } from './paystack';
export { manualProvider } from './manual';
export { freeProvider } from './free';
export { providerRegistry } from '../payment-provider';

import { providerRegistry } from '../payment-provider';
import { paystackProvider } from './paystack';
import { manualProvider } from './manual';
import { freeProvider } from './free';

// Register all providers with the registry
providerRegistry.register(paystackProvider);
providerRegistry.register(manualProvider);
providerRegistry.register(freeProvider);
