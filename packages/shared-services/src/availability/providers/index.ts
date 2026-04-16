/**
 * Provider Registry
 *
 * Central registry for all availability providers.
 * Providers register themselves here and are instantiated by type.
 */

import type { ProviderConfig } from '../types';
import { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
import { IC3OtiumProvider } from './IC3OtiumProvider';
import { ActivityMessengerProvider } from './ActivityMessengerProvider';

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

/**
 * Map of provider types to their constructor classes.
 * Add new providers here when implementing additional data sources.
 */
type ProviderConstructor = new (config: ProviderConfig) => BaseAvailabilityProvider;

const providerRegistry: Record<string, ProviderConstructor> = {
  ic3_otium: IC3OtiumProvider,
  activity_messenger: ActivityMessengerProvider,
  // Backward compatibility alias for existing data_provider rows
  loisir_montreal: IC3OtiumProvider,
};

/**
 * Get a provider instance for the given configuration.
 *
 * @param config - Provider configuration from database
 * @returns Provider instance
 * @throws Error if provider type is not registered
 */
export function getProvider(config: ProviderConfig): BaseAvailabilityProvider {
  const ProviderClass = providerRegistry[config.providerType];

  if (!ProviderClass) {
    throw new Error(`Unknown provider type: ${config.providerType}`);
  }

  return new ProviderClass(config);
}

/**
 * Check if a provider type is registered.
 *
 * @param providerType - Provider type to check
 * @returns True if provider is registered
 */
export function isProviderRegistered(providerType: string): boolean {
  return providerType in providerRegistry;
}

/**
 * Get list of all registered provider types.
 *
 * @returns Array of registered provider type strings
 */
export function getRegisteredProviders(): string[] {
  return Object.keys(providerRegistry);
}

// =============================================================================
// EXPORTS
// =============================================================================

export { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
export { IC3OtiumProvider } from './IC3OtiumProvider';
export { IC3OtiumProvider as LoisirMontrealProvider } from './IC3OtiumProvider';
export { ActivityMessengerProvider } from './ActivityMessengerProvider';
