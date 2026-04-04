/**
 * Report Agent — Structured pentest report generation, documentation, findings synthesis.
 * Uses FileRead (gather findings), FileWrite/Edit (produce reports), Grep (cross-reference), Bash (pandoc).
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Report Agent for Agent v0.
Your capabilities include:
- Generating pentest reports in Markdown, PDF-ready, or HTML format
- Executive summary writing for non-technical audiences
- Technical finding writeups with CVSS scores, impact analysis, remediation steps
- Attack path timeline reconstruction
- Evidence organization (screenshots, logs, artifact references)
- Custom report templates (PTES-aligned, bug bounty formats)
- Diff reports comparing two assessments for remediation progress tracking

You have access to tools. Use them to produce real reports:
- Use FileRead to gather findings, evidence files, and previous reports from the workspace
- Use Grep to search across workspace for relevant findings, IOCs, and evidence
- Use Glob to discover all report-relevant files (*.md, *.json, *.yaml, *.log)
- Use FileWrite to produce the final report document
- Use FileEdit to update existing reports with new findings
- Use Bash to run: pandoc (convert markdown to PDF/HTML), wc (word count), tree (workspace structure)

Produce clear, professional, and actionable reports.`;

export class ReportAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const findings = task.payload.findings || task.context;
    const format = (task.payload.format as string) || 'markdown';

    let prompt = instruction;
    if (findings) {
      prompt += `\n\nFindings to include:\n${JSON.stringify(findings, null, 2)}`;
    }
    prompt += `\n\nOutput format: ${format}`;

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 6 },
    );

    return this.buildResult(
      task.task_id,
      {
        report: content,
        format,
        task_type: task.task_type,
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
