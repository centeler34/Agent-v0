/**
 * Code Agent — Code analysis, generation, security review, and exploit development assistance.
 * Uses Grep (pattern search), FileRead/Edit/Write, Bash (linters, compilers), Glob (file discovery).
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

You have access to tools. Use them to perform real analysis:
- Use Grep to search for vulnerable patterns (eval, exec, SQL queries, unsanitized input)
- Use Glob to discover relevant source files (*.py, *.js, *.go, etc.)
- Use FileRead to read and analyze source code
- Use FileEdit to patch vulnerabilities or insert fixes
- Use FileWrite to generate PoC scripts or reports
- Use Bash to run linters (eslint, bandit, semgrep), compilers, or test suites

Always map findings to CWE IDs and OWASP categories where applicable.
Use tools to gather real data from the codebase before providing analysis.`;

export class CodeAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const code = (task.payload.code as string) || '';
    const filePath = (task.payload.file_path as string) || '';

    let prompt = instruction;
    if (code) {
      prompt += `\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\``;
    }
    if (filePath) {
      prompt += `\n\nTarget file: ${filePath}`;
    }

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 10 },
    );

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
        files_analyzed: toolResults
          .filter(r => r.tool === 'FileRead' || r.tool === 'Grep')
          .length,
      },
      startTime,
      usage,
    );
  }
}
