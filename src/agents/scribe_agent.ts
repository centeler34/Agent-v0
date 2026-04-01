/**
 * Scribe Agent — Knowledge management, documentation automation, note organization.
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
Produce clear, well-organized documentation with consistent formatting.`;

export class ScribeAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, instruction);

    return this.buildResult(
      task.task_id,
      {
        document: content,
        task_type: task.task_type,
        format: task.payload.format || 'markdown',
      },
      startTime,
      usage,
    );
  }
}
