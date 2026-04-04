/**
 * Agent v0 — Tool Introspection
 *
 * Provides transparent access to the REAL tool definitions that Agent v0
 * sends to the Claude API. No fake schemas — this is the actual source of
 * truth for what the AI model sees when executing tasks.
 *
 * Use `getToolDefinitions()` to get the exact JSON Schema + descriptions
 * that are sent in every API request. Use `dumpToolDefinitionsToFile()` to
 * save them for offline inspection.
 *
 * This module exists because transparency matters: if you want to know
 * what's happening under the hood, you should be able to see the real
 * tool definitions, not a sanitized summary.
 */

import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { Tool, Tools, ToolPermissionContext } from '../Tool.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { zodToJsonSchema } from './zodToJsonSchema.js'

export interface ToolDefinition {
  /** Tool name as sent to the API */
  name: string
  /** Full description/prompt text the model receives */
  description: string
  /** JSON Schema for the tool's input parameters */
  input_schema: Record<string, unknown>
  /** Whether the tool is currently enabled */
  enabled: boolean
  /** Whether the tool is read-only (no side effects) */
  read_only: boolean
  /** Whether the tool can run concurrently with others */
  concurrency_safe: boolean
  /** Aliases for backwards compatibility */
  aliases?: string[]
  /** Search hint for ToolSearch discovery */
  search_hint?: string
  /** Whether this is an MCP (Model Context Protocol) tool */
  is_mcp: boolean
}

export interface ToolIntrospectionResult {
  /** ISO timestamp of when this snapshot was taken */
  timestamp: string
  /** Agent v0 version */
  version: string
  /** Total number of tools available */
  tool_count: number
  /** The real tool definitions sent to the Claude API */
  tools: ToolDefinition[]
}

/**
 * Get the real tool definitions that Agent v0 sends to the Claude API.
 *
 * This returns the actual `name`, `description` (prompt text), and
 * `input_schema` (JSON Schema) for every registered tool. These are
 * the exact definitions the AI model receives — nothing is hidden,
 * nothing is fabricated.
 *
 * @param tools - The tool array from `getTools()` or `getAllBaseTools()`
 * @param permissionContext - Optional permission context for description generation
 */
export async function getToolDefinitions(
  tools: Tools,
  permissionContext?: ToolPermissionContext,
): Promise<ToolIntrospectionResult> {
  const ctx = permissionContext ?? getEmptyToolPermissionContext()
  const definitions: ToolDefinition[] = []

  for (const tool of tools) {
    try {
      // Get the real description that's sent to the API
      const description = await tool.prompt({
        getToolPermissionContext: async () => ctx,
        tools,
        agents: [],
        allowedAgentTypes: undefined,
      })

      // Get the real JSON Schema for inputs
      const input_schema =
        'inputJSONSchema' in tool && tool.inputJSONSchema
          ? tool.inputJSONSchema
          : zodToJsonSchema(tool.inputSchema)

      definitions.push({
        name: tool.name,
        description,
        input_schema: input_schema as Record<string, unknown>,
        enabled: tool.isEnabled(),
        read_only: tool.isReadOnly({}),
        concurrency_safe: tool.isConcurrencySafe({}),
        aliases: tool.aliases,
        search_hint: tool.searchHint,
        is_mcp: tool.isMcp ?? false,
      })
    } catch {
      // Tool prompt generation may fail for some tools (e.g., missing context).
      // Include them with a note rather than silently dropping.
      definitions.push({
        name: tool.name,
        description: `[introspection error: tool prompt requires runtime context]`,
        input_schema: zodToJsonSchema(tool.inputSchema) as Record<string, unknown>,
        enabled: tool.isEnabled(),
        read_only: false,
        concurrency_safe: false,
        is_mcp: tool.isMcp ?? false,
      })
    }
  }

  return {
    timestamp: new Date().toISOString(),
    version: MACRO.VERSION ?? 'dev',
    tool_count: definitions.length,
    tools: definitions,
  }
}

/**
 * Dump real tool definitions to a JSON file for offline inspection.
 *
 * @param tools - The tool array from `getTools()` or `getAllBaseTools()`
 * @param outputPath - Where to write the JSON file
 * @param permissionContext - Optional permission context
 */
export async function dumpToolDefinitionsToFile(
  tools: Tools,
  outputPath: string,
  permissionContext?: ToolPermissionContext,
): Promise<void> {
  const result = await getToolDefinitions(tools, permissionContext)
  await fs.mkdir(dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8')
}

/**
 * Get a compact summary of available tools (for CLI display).
 */
export function getToolSummary(tools: Tools): string {
  const lines: string[] = [
    'Agent v0 — Tool Definitions (Real API Schemas)',
    '═'.repeat(50),
    '',
  ]

  for (const tool of tools) {
    const enabled = tool.isEnabled()
    const readOnly = tool.isReadOnly({})
    const flags = [
      enabled ? '✓' : '✗',
      readOnly ? 'RO' : 'RW',
      tool.isMcp ? 'MCP' : '',
    ]
      .filter(Boolean)
      .join(' ')

    lines.push(`  ${tool.name.padEnd(25)} [${flags}]`)
    if (tool.searchHint) {
      lines.push(`    └─ ${tool.searchHint}`)
    }
  }

  lines.push('')
  lines.push(`Total: ${tools.length} tools`)
  lines.push('')
  lines.push('Run `agent-v0 tools --json` for full JSON Schema definitions')
  lines.push('Run `agent-v0 tools --dump <path>` to save to file')

  return lines.join('\n')
}
