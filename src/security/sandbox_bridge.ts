/**
 * TypeScript FFI bridge to agent-v0-sandbox Rust crate.
 * MVP: path validation in TS. v1.0: calls into Rust bubblewrap wrapper via napi-rs.
 */

import path from 'node:path';
import fs from 'node:fs';

export class SandboxBridge {
  /**
   * Validate that a path is within the agent's workspace root.
   * Canonicalizes the path and checks it doesn't escape the sandbox.
   */
  validatePath(requestedPath: string, workspaceRoot: string): { allowed: boolean; resolved: string; error?: string } {
    try {
      const resolvedWorkspace = fs.realpathSync(workspaceRoot);
      let resolvedPath: string;

      if (fs.existsSync(requestedPath)) {
        resolvedPath = fs.realpathSync(requestedPath);
      } else {
        // For paths that don't exist yet, resolve the parent
        const parent = path.dirname(requestedPath);
        if (fs.existsSync(parent)) {
          resolvedPath = path.join(fs.realpathSync(parent), path.basename(requestedPath));
        } else {
          resolvedPath = path.resolve(requestedPath);
        }
      }

      if (!resolvedPath.startsWith(resolvedWorkspace)) {
        return {
          allowed: false,
          resolved: resolvedPath,
          error: `Path ${resolvedPath} is outside workspace ${resolvedWorkspace}`,
        };
      }

      return { allowed: true, resolved: resolvedPath };
    } catch (err) {
      return {
        allowed: false,
        resolved: requestedPath,
        error: `Path validation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Check if a binary is in the agent's allowed list.
   */
  validateBinary(binary: string, allowedBinaries: string[]): boolean {
    const resolved = path.resolve(binary);
    return allowedBinaries.some((allowed) => {
      const resolvedAllowed = path.resolve(allowed);
      return resolved === resolvedAllowed;
    });
  }
}
