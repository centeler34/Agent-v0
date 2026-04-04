/**
 * Forensics Agent — Digital forensics, artifact analysis, incident reconstruction.
 * Uses Bash (volatility, strings, file, yara), Grep (log parsing), FileRead/Write.
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Forensics Agent for Agent v0.
Your capabilities include:
- Log timeline reconstruction and event correlation
- Memory dump analysis guidance (Volatility output as input)
- File artifact analysis: metadata extraction, hash verification, entropy analysis
- PCAP parsing and network anomaly detection
- Malware static analysis (strings, imports, packing detection, YARA matching)
- Incident timeline drafting and evidence chain-of-custody documentation
- Windows registry hive analysis
- Browser and application artifact extraction

You have access to tools. Use them to perform real forensic analysis:
- Use Bash to run: strings, file, md5sum/sha256sum, xxd, binwalk, volatility, yara, tshark
- Use Grep to parse logs for IOCs, timestamps, error patterns, IP addresses
- Use FileRead to examine artifact contents, config files, registry exports
- Use FileWrite to save timelines, evidence summaries, and YARA rules
- Use Glob to discover relevant artifacts in the workspace

Maintain strict evidence handling and chain-of-custody documentation.
Always hash files before and after analysis. Document every tool invocation.`;

export class ForensicsAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const evidencePath = (task.payload.evidence_path as string) || '';

    let prompt = instruction;
    if (evidencePath) {
      prompt += `\n\nEvidence location: ${evidencePath}`;
    }

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 8 },
    );

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        timeline: [],
        evidence: [],
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
