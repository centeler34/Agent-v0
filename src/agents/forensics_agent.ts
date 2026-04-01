/**
 * Forensics Agent — Digital forensics, artifact analysis, incident reconstruction.
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
Maintain strict evidence handling and chain-of-custody documentation.`;

export class ForensicsAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, instruction);

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        timeline: [],
        evidence: [],
      },
      startTime,
      usage,
    );
  }
}
