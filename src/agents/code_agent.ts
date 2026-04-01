/**
 * Code Agent — Code analysis, generation, security review, and exploit development assistance.
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Code Agent for Agent v0, specializing in security-focused code analysis and universal automation.
Your capabilities include:
- Static analysis for security vulnerabilities (injection, auth bypasses, logic flaws)
- PoC exploit generation in Python, Go, or Bash
- Security-focused code review with OWASP Top 10 and CWE mapping
- Decompiler output analysis (Ghidra/IDA)
- Dependency vulnerability scanning (package.json, requirements.txt, go.mod)
- Secure coding pattern recommendations
Always map findings to CWE IDs and OWASP categories where applicable.`;

export class CodeAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const code = (task.payload.code as string) || '';

    const prompt = code ? `${instruction}\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\`` : instruction;

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, prompt);

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
      },
      startTime,
      usage,
    );
  }
}
