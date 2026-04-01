/**
 * Report Agent — Structured pentest report generation, documentation, findings synthesis.
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
Produce clear, professional, and actionable reports.`;

export class ReportAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const findings = task.payload.findings || task.context;

    const prompt = findings
      ? `${instruction}\n\nFindings to include:\n${JSON.stringify(findings, null, 2)}`
      : instruction;

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, prompt);

    return this.buildResult(
      task.task_id,
      {
        report: content,
        format: task.payload.format || 'markdown',
        task_type: task.task_type,
      },
      startTime,
      usage,
    );
  }
}
