/**
 * Shared PostHog feature flag key constants.
 * Use these across web and mobile to ensure consistent flag references.
 */
export const FEATURE_FLAGS = {} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];
