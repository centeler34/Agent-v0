/**
 * Threat Intelligence Agent — Threat actor tracking, IOC management, strategic intel.
 * Uses WebFetch (MISP, OTX, VirusTotal), Bash (ioc-parser), Grep, FileRead/Write.
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

You have access to tools. Use them to gather real intelligence:
- Use WebFetch to query VirusTotal API, OTX API, AbuseIPDB, URLhaus, MalwareBazaar
- Use Bash to run: ioc-parser, stix2-validator, curl for TAXII feeds
- Use Grep to search IOC databases, log files for indicator matches
- Use FileRead to examine existing threat intel reports or STIX bundles
- Use FileWrite to save IOC lists, STIX documents, and threat actor profiles

Provide intelligence with clear confidence levels and sourcing.`;

export class ThreatIntelAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const iocs = (task.payload.iocs as string[]) || [];

    let prompt = instruction;
    if (iocs.length > 0) {
      prompt += `\n\nIOCs to investigate:\n${iocs.map(i => `- ${i}`).join('\n')}`;
    }

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 8 },
    );

    return this.buildResult(
      task.task_id,
      {
        intelligence: content,
        task_type: task.task_type,
        iocs: [],
        ttp_mappings: [],
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
