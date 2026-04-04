/**
 * Agent v0 — Agent Toolkit
 *
 * Bundles all available tools into a single object that agents
 * receive when executing tasks. Enforces per-agent tool allowlists
 * and workspace sandboxing.
 */

import type { AgentRole } from '../types/agent_config.js';
import {
  execBash,
  execGrep,
  execGlob,
  execFileRead,
  execFileWrite,
  execFileEdit,
  execWebFetch,
  isToolAllowed,
  type ToolResult,
  type ToolName,
} from './tool_runtime.js';

export class AgentToolkit {
  readonly agentId: AgentRole;
  readonly workspace: string;
  private readonly allowed: Set<ToolName>;

  constructor(agentId: AgentRole, workspace: string) {
    this.agentId = agentId;
    this.workspace = workspace;
    this.allowed = new Set(
      (['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit', 'WebFetch'] as ToolName[])
        .filter(t => isToolAllowed(agentId, t)),
    );
  }

  private assertAllowed(tool: ToolName): void {
    if (!this.allowed.has(tool)) {
      throw new Error(`Agent ${this.agentId} is not permitted to use tool: ${tool}`);
    }
  }

  /** List tools available to this agent. */
  availableTools(): ToolName[] {
    return [...this.allowed];
  }

  /** Execute a shell command. */
  bash(command: string, opts?: { timeout_ms?: number }): ToolResult {
    this.assertAllowed('Bash');
    return execBash(command, {
      cwd: this.workspace,
      timeout_ms: opts?.timeout_ms,
      agent_id: this.agentId,
    });
  }

  /** Search file contents with ripgrep. */
  grep(pattern: string, opts?: {
    path?: string;
    glob?: string;
    type?: string;
    case_insensitive?: boolean;
    max_results?: number;
    output_mode?: 'content' | 'files_with_matches' | 'count';
    context_lines?: number;
  }): ToolResult {
    this.assertAllowed('Grep');
    return execGrep(pattern, {
      cwd: this.workspace,
      agent_id: this.agentId,
      ...opts,
    });
  }

  /** Find files by name pattern. */
  glob(pattern: string, opts?: { max_results?: number }): ToolResult {
    this.assertAllowed('Glob');
    return execGlob(pattern, {
      cwd: this.workspace,
      agent_id: this.agentId,
      ...opts,
    });
  }

  /** Read a file with line numbers. */
  readFile(filePath: string, opts?: { offset?: number; limit?: number }): ToolResult {
    this.assertAllowed('FileRead');
    return execFileRead(filePath, {
      cwd: this.workspace,
      agent_id: this.agentId,
      ...opts,
    });
  }

  /** Write or create a file. */
  writeFile(filePath: string, content: string): ToolResult {
    this.assertAllowed('FileWrite');
    return execFileWrite(filePath, content, {
      cwd: this.workspace,
      agent_id: this.agentId,
    });
  }

  /** Find-and-replace in a file. */
  editFile(filePath: string, oldString: string, newString: string, opts?: { replace_all?: boolean }): ToolResult {
    this.assertAllowed('FileEdit');
    return execFileEdit(filePath, oldString, newString, {
      cwd: this.workspace,
      agent_id: this.agentId,
      ...opts,
    });
  }

  /** Fetch a URL (HTTP/HTTPS only). */
  async webFetch(url: string, opts?: { timeout_ms?: number }): Promise<ToolResult> {
    this.assertAllowed('WebFetch');
    return execWebFetch(url, {
      agent_id: this.agentId,
      ...opts,
    });
  }

  /**
   * Generate a tool description string for inclusion in agent system prompts.
   * This tells the AI model what tools are available.
   */
  describeTools(): string {
    const descriptions: Record<ToolName, string> = {
      Bash: 'Execute shell commands in the workspace directory',
      Grep: 'Search file contents using ripgrep regex patterns',
      Glob: 'Find files by name pattern (e.g., "*.ts", "*.yaml")',
      FileRead: 'Read file contents with line numbers',
      FileWrite: 'Write or create files in the workspace',
      FileEdit: 'Find-and-replace text within files',
      WebFetch: 'Fetch content from HTTP/HTTPS URLs',
    };

    const lines = [`Available tools for ${this.agentId} agent:`];
    for (const tool of this.allowed) {
      lines.push(`  - ${tool}: ${descriptions[tool]}`);
    }
    return lines.join('\n');
  }
}
