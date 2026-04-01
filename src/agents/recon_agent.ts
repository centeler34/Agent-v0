/**
 * Recon Agent — Passive/active reconnaissance, OSINT collection, attack surface mapping.
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Recon Agent for Agent v0, specializing in passive and active reconnaissance.
Your capabilities include:
- Subdomain enumeration (certificate transparency, DNS brute force, permutation)
- DNS record analysis (A, AAAA, CNAME, MX, TXT, SPF, DMARC)
- IP range and ASN lookups
- Technology fingerprinting (HTTP headers, banners, favicon hashing)
- Shodan, Censys, and GreyNoise queries
- GitHub dork searches
- WHOIS history and registrar analysis
- Wayback Machine crawling
Output structured findings as YAML or JSON.`;

export class ReconAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, instruction);

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        target: task.payload.domain || task.payload.target || 'unknown',
      },
      startTime,
      usage,
    );
  }
}
