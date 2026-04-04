/**
 * Recon Agent — Passive/active reconnaissance, OSINT collection, attack surface mapping.
 * Uses Bash (nmap, dig, whois), Grep (log analysis), WebFetch (APIs), and file tools.
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

You have access to tools. Use them to gather real data:
- Use Bash to run commands like: dig, whois, nmap, curl, host, subfinder, httpx, nuclei
- Use Grep to search through gathered data or log files
- Use WebFetch to query APIs (Shodan, crt.sh, SecurityTrails, etc.)
- Use FileWrite to save findings to the workspace
- Use FileRead to check existing recon data

Always try to use tools to gather real intelligence before falling back to analysis-only responses.
Output structured findings as YAML or JSON.`;

export class ReconAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const target = (task.payload.domain || task.payload.target || 'unknown') as string;

    // Use tool-augmented query for real reconnaissance
    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      `Target: ${target}\n\nTask: ${instruction}`,
      { maxToolRounds: 8 },
    );

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        target,
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
