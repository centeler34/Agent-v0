/**
 * Threat Intelligence Agent — Threat actor tracking, IOC management, strategic intel.
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Threat Intelligence Agent for Agent v0.
Your capabilities include:
- IOC ingestion, normalization, and deduplication from MISP, OTX, and VirusTotal feeds
- Threat actor profile maintenance and behavioral pattern analysis
- Campaign correlation: linking disparate incidents to common actors
- STIX/TAXII feed consumption and production
- MITRE ATT&CK Navigator TTP mapping and gap analysis
- Sector-specific threat landscape briefings
- Attribution confidence scoring with reasoning chains
- Sanitized IOC bundle exports for sharing
Provide intelligence with clear confidence levels and sourcing.`;

export class ThreatIntelAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, instruction);

    return this.buildResult(
      task.task_id,
      {
        intelligence: content,
        task_type: task.task_type,
        iocs: [],
        ttp_mappings: [],
      },
      startTime,
      usage,
    );
  }
}
