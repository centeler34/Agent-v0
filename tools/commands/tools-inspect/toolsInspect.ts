/**
 * /tools-inspect command
 *
 * Shows the REAL tool definitions that Agent v0 sends to the Claude API.
 * No fake schemas, no hidden definitions — this is what the AI model
 * actually receives when processing your tasks.
 *
 * Usage:
 *   /tools-inspect           — Show compact tool summary
 *   /tools-inspect --json    — Output full JSON Schema definitions
 *   /tools-inspect --dump    — Save definitions to ~/.agent-v0/tool-definitions.json
 *   /tools-inspect <name>    — Show full definition for a specific tool
 */

import { join } from 'path'
import type { LocalCommandResult } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import { getAllBaseTools } from '../../tools.js'
import {
  getToolDefinitions,
  getToolSummary,
  dumpToolDefinitionsToFile,
} from '../../utils/toolIntrospection.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getLastApiRequests } from '../../services/api/dumpPrompts.js'

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

export async function call(
  args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  const tools = context.options.tools.length > 0
    ? context.options.tools
    : getAllBaseTools()

  const trimmedArgs = args.trim()

  // --json: Full JSON Schema output
  if (trimmedArgs === '--json') {
    const result = await getToolDefinitions(tools)
    return text(JSON.stringify(result, null, 2))
  }

  // --dump: Save to file
  if (trimmedArgs === '--dump' || trimmedArgs.startsWith('--dump ')) {
    const customPath = trimmedArgs.replace('--dump', '').trim()
    const outputPath = customPath || join(getClaudeConfigHomeDir(), 'tool-definitions.json')
    await dumpToolDefinitionsToFile(tools, outputPath)
    return text(
      `Tool definitions saved to: ${outputPath}\n\nThis file contains the exact JSON Schema definitions sent to the Claude API.\nOpen it to see every tool name, description, and input parameter schema.`,
    )
  }

  // --last-request: Show the last real API request (includes tool schemas as sent)
  if (trimmedArgs === '--last-request') {
    const requests = getLastApiRequests()
    if (requests.length === 0) {
      return text(
        'No API requests cached yet. Send a message first, then run /tools-inspect --last-request to see the real API payload.',
      )
    }
    const lastRequest = requests[requests.length - 1]
    return text(JSON.stringify(lastRequest, null, 2))
  }

  // <tool-name>: Show specific tool definition
  if (trimmedArgs && !trimmedArgs.startsWith('--')) {
    const result = await getToolDefinitions(tools)
    const tool = result.tools.find(
      t =>
        t.name.toLowerCase() === trimmedArgs.toLowerCase() ||
        t.aliases?.some(a => a.toLowerCase() === trimmedArgs.toLowerCase()),
    )
    if (!tool) {
      const available = result.tools.map(t => t.name).join(', ')
      return text(`Tool "${trimmedArgs}" not found.\n\nAvailable tools: ${available}`)
    }
    return text(
      [
        `Tool: ${tool.name}`,
        tool.aliases?.length ? `Aliases: ${tool.aliases.join(', ')}` : null,
        `Enabled: ${tool.enabled}`,
        `Read-only: ${tool.read_only}`,
        `Concurrency-safe: ${tool.concurrency_safe}`,
        tool.search_hint ? `Search hint: ${tool.search_hint}` : null,
        tool.is_mcp ? `Type: MCP (Model Context Protocol)` : null,
        '',
        '── Description (sent to Claude API) ──',
        tool.description,
        '',
        '── Input Schema (JSON Schema) ──',
        JSON.stringify(tool.input_schema, null, 2),
      ]
        .filter(line => line !== null)
        .join('\n'),
    )
  }

  // Default: compact summary
  return text(getToolSummary(tools))
}
