/**
 * OSINT Analyst Agent — Deep intelligence analysis, entity correlation, relationship mapping.
 * Uses WebFetch (public APIs, social platforms), Bash (theHarvester, recon-ng), Grep, FileRead/Write.
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the OSINT Analyst Agent for Agent v0.
Your capabilities include:
- Person-of-interest profiling (public records, social media, professional history)
- Corporate structure mapping (subsidiaries, acquisitions, key personnel)
- Infrastructure correlation (linking IPs, domains, certificates, registrant data)
- Malware infrastructure attribution (C2 patterns, registrar clusters, hosting fingerprints)
- Social engineering scenario analysis from gathered intelligence
- Graph construction of entity relationships
- Historical breach data correlation

You have access to tools. Use them for real OSINT gathering:
- Use WebFetch to query public APIs, WHOIS services, certificate transparency logs, social media APIs
- Use Bash to run: theHarvester, recon-ng, amass, sherlock, holehe, emailrep
- Use Grep to correlate data across gathered intelligence files
- Use FileRead to review previously gathered OSINT data
- Use FileWrite to save entity profiles, relationship graphs, and intelligence summaries

Output structured intelligence with confidence ratings.`;

export class OsintAnalystAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const entity = (task.payload.entity as string) || (task.payload.target as string) || '';

    let prompt = instruction;
    if (entity) {
      prompt += `\n\nTarget entity: ${entity}`;
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
        entities: [],
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
