/**
 * Agent v0 — Compatibility Layer
 *
 * Re-exports all shims needed to run the tools/ codebase
 * outside of the Bun bundler environment.
 */

export { feature, setFeatureFlag, getFeatureFlags } from './bun-bundle-shim.js';
