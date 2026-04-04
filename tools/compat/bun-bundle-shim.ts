/**
 * Agent v0 — bun:bundle compatibility shim
 *
 * Replaces Bun's compile-time `feature()` function with a runtime
 * feature-flag registry. All flags default to `true` so the full
 * tool surface is available unless explicitly disabled.
 */

const FEATURE_FLAGS: Record<string, boolean> = {
  // Core features — enabled by default for Agent v0
  BRIDGE_MODE: true,
  CCR_AUTO_CONNECT: false,
  CCR_MIRROR: false,
  COORDINATOR_MODE: true,
  PROACTIVE: true,
  KAIROS: false,
  KAIROS_BRIEF: false,
  KAIROS_PUSH_NOTIFICATION: false,
  KAIROS_GITHUB_WEBHOOKS: false,
  MONITOR_TOOL: true,
  WORKFLOW_SCRIPTS: true,
  AGENT_TRIGGERS: true,
  AGENT_TRIGGERS_REMOTE: true,
  TOKEN_BUDGET: true,
  REACTIVE_COMPACT: true,
  CONTEXT_COLLAPSE: true,
  CACHED_MICROCOMPACT: true,
  CONNECTOR_TEXT: false,
  TRANSCRIPT_CLASSIFIER: false,
  VERIFICATION_AGENT: true,
  EXPERIMENTAL_SKILL_SEARCH: true,
  MEMORY_SHAPE_TELEMETRY: false,
  TEAMMEM: false,
  EXTRACT_MEMORIES: true,
  NATIVE_CLIENT_ATTESTATION: false,
};

/**
 * Runtime replacement for Bun's compile-time `feature()` macro.
 * Returns true if the flag is enabled, false otherwise.
 */
export function feature(flag: string): boolean {
  if (flag in FEATURE_FLAGS) {
    return FEATURE_FLAGS[flag];
  }
  // Unknown flags default to false for safety
  return false;
}

/**
 * Enable or disable a feature flag at runtime.
 */
export function setFeatureFlag(flag: string, enabled: boolean): void {
  FEATURE_FLAGS[flag] = enabled;
}

/**
 * Get all current feature flag states.
 */
export function getFeatureFlags(): Readonly<Record<string, boolean>> {
  return { ...FEATURE_FLAGS };
}
