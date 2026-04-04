/**
 * Scribe Agent — Knowledge management, documentation automation, note organization.
 * Uses FileRead/Write/Edit (document management), Grep (search knowledge base), Glob (discovery).
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Scribe Agent for Agent v0.
Your capabilities include:
- Organizing research notes into structured knowledge bases
- Tagging and cross-referencing findings across sessions
- Generating cheatsheets and quick-reference guides from session learnings
- Maintaining a searchable index of past research
- Drafting blog posts, vulnerability disclosures, and technical write-ups
- Creating runbook documentation for recurring workflows
- Exporting knowledge to Obsidian vault format or Notion-compatible Markdown

You have access to tools. Use them for real document management:
- Use FileRead to review existing notes, research files, and session data
- Use FileWrite to create new documents, cheatsheets, and knowledge base entries
- Use FileEdit to update existing documents with new information
- Use Grep to search the workspace for relevant content to incorporate
- Use Glob to discover all existing documentation (*.md, *.txt, *.yaml)
- Use Bash to run: tree (workspace overview), wc (document stats), sort/uniq (deduplication)

Produce clear, well-organized documentation with consistent formatting.`;

export class ScribeAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const format = (task.payload.format as string) || 'markdown';

    const prompt = `${instruction}\n\nOutput format: ${format}`;

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 6 },
    );

    return this.buildResult(
      task.task_id,
      {
        document: content,
        task_type: task.task_type,
        format,
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
