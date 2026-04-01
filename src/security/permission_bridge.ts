/**
 * TypeScript FFI bridge to agent-v0-permissions Rust crate.
 * MVP: pure-TS permission evaluation.
 */

import path from 'node:path';
import type { AgentPermissions } from '../types/agent_config.js';

export type PermissionRequest =
  | { type: 'fs_read'; path: string }
  | { type: 'fs_write'; path: string }
  | { type: 'fs_execute'; binary: string }
  | { type: 'network'; host: string }
  | { type: 'api_provider'; provider: string }
  | { type: 'api_key'; key: string }
  | { type: 'agent_communicate'; agentId: string }
  | { type: 'agent_spawn' };

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export class PermissionBridge {
  evaluate(permissions: AgentPermissions, request: PermissionRequest): PermissionDecision {
    switch (request.type) {
      case 'fs_read':
        return this.checkGlob(permissions.fs_read, request.path, 'fs_read');

      case 'fs_write':
        return this.checkGlob(permissions.fs_write, request.path, 'fs_write');

      case 'fs_execute':
        if (!permissions.fs_execute) {
          return { allowed: false, reason: 'Agent does not have fs_execute permission' };
        }
        if (!permissions.execute_allowed_binaries.includes(request.binary)) {
          return { allowed: false, reason: `Binary not in allowlist: ${request.binary}` };
        }
        return { allowed: true };

      case 'network':
        return this.checkNetwork(permissions, request.host);

      case 'api_provider':
        if (permissions.api_providers.length === 0 || permissions.api_providers.includes(request.provider)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Provider not allowed: ${request.provider}` };

      case 'api_key':
        if (permissions.api_keys.length === 0 || permissions.api_keys.includes(request.key)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Key access not allowed: ${request.key}` };

      case 'agent_communicate':
        if (permissions.agent_communicate.length === 0 || permissions.agent_communicate.includes(request.agentId)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Cannot communicate with agent: ${request.agentId}` };

      case 'agent_spawn':
        return permissions.agent_spawn
          ? { allowed: true }
          : { allowed: false, reason: 'Agent cannot spawn new agents' };
    }
  }

  private checkGlob(patterns: string[], requestedPath: string, label: string): PermissionDecision {
    if (patterns.length === 0) {
      return { allowed: false, reason: `No ${label} paths configured` };
    }

    const normalized = path.normalize(requestedPath);
    for (const pattern of patterns) {
      const normalizedPattern = path.normalize(pattern);
      if (normalized.startsWith(normalizedPattern) || this.globMatch(normalizedPattern, normalized)) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: `Path ${requestedPath} not in ${label} allowlist` };
  }

  private checkNetwork(permissions: AgentPermissions, host: string): PermissionDecision {
    // Deny list takes precedence
    for (const denied of permissions.network_deny) {
      if (this.hostMatch(denied, host)) {
        return { allowed: false, reason: `Host denied by network_deny: ${denied}` };
      }
    }

    if (permissions.network_allow.length === 0) {
      return { allowed: false, reason: 'No network access allowed' };
    }

    for (const allowed of permissions.network_allow) {
      if (this.hostMatch(allowed, host)) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: `Host ${host} not in network allowlist` };
  }

  private hostMatch(pattern: string, host: string): boolean {
    if (pattern === host) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.substring(1);
      return host.endsWith(suffix) || host === pattern.substring(2);
    }
    return false;
  }

  private globMatch(pattern: string, target: string): boolean {
    // Simple glob: treat trailing / as prefix match
    if (pattern.endsWith('/')) {
      return target.startsWith(pattern) || target + '/' === pattern;
    }
    return target === pattern;
  }
}
