/**
 * Agent v0 — Tools Integration Bridge
 *
 * Connects the tools/ framework (tool definitions, task execution,
 * cost tracking, commands) to the Agent v0 orchestrator (src/).
 *
 * This module acts as the glue layer so agents can use the tool
 * system (BashTool, FileReadTool, GrepTool, etc.) for their work.
 */

import { feature } from './compat/bun-bundle-shim.js';

// ── Tool Registry ──────────────────────────────────────────────────────────

export interface AgentV0Tool {
  name: string;
  description: string;
  category: 'filesystem' | 'search' | 'execution' | 'network' | 'agent' | 'utility';
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Tool Categories for Agent v0 ───────────────────────────────────────────

/**
 * Maps the tools/ framework tools to Agent v0 agent capabilities.
 * Each agent type gets access to a specific set of tools.
 */
export const AGENT_TOOL_PROFILES: Record<string, string[]> = {
  recon: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite',
    'WebFetch', 'WebSearch', 'TaskOutput',
  ],
  code: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileEdit', 'FileWrite',
    'NotebookEdit', 'TaskOutput',
  ],
  exploit_research: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite',
    'WebFetch', 'WebSearch', 'TaskOutput',
  ],
  forensics: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite',
    'NotebookEdit', 'TaskOutput',
  ],
  osint_analyst: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite',
    'WebFetch', 'WebSearch', 'TaskOutput',
  ],
  threat_intel: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite',
    'WebFetch', 'WebSearch', 'TaskOutput',
  ],
  report: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileEdit', 'FileWrite',
    'TaskOutput',
  ],
  monitor: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'WebFetch',
    'TaskOutput',
  ],
  scribe: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileEdit', 'FileWrite',
    'TaskOutput',
  ],
  // The orchestrator gets everything
  agentic: [
    'Bash', 'Grep', 'Glob', 'FileRead', 'FileEdit', 'FileWrite',
    'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'TaskOutput',
    'TodoWrite',
  ],
};

// ── Cost Bridge ────────────────────────────────────────────────────────────

export interface CostSnapshot {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  byModel: Record<string, { input: number; output: number; cost: number }>;
  byAgent: Record<string, { input: number; output: number; cost: number }>;
}

// ── Session Bridge ─────────────────────────────────────────────────────────

export interface ToolSession {
  id: string;
  agentId: string;
  startedAt: number;
  tools: string[];
  workingDirectory: string;
}

const activeSessions = new Map<string, ToolSession>();

export function createToolSession(
  sessionId: string,
  agentId: string,
  workingDirectory: string,
): ToolSession {
  const profile = AGENT_TOOL_PROFILES[agentId] ?? AGENT_TOOL_PROFILES['agentic'];
  const session: ToolSession = {
    id: sessionId,
    agentId,
    startedAt: Date.now(),
    tools: profile,
    workingDirectory,
  };
  activeSessions.set(sessionId, session);
  return session;
}

export function getToolSession(sessionId: string): ToolSession | undefined {
  return activeSessions.get(sessionId);
}

export function endToolSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

// ── Exports ────────────────────────────────────────────────────────────────

export const VERSION = '1.3.0';
export const PROJECT_NAME = 'Agent v0';
