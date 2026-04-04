/**
 * Monitor Agent — Continuous monitoring, alerting, and threat detection.
 * Uses WebFetch (RSS, APIs), Bash (port scanning, DNS checks), Grep (log analysis).
 */

import { BaseAgent } from './base_agent.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const SYSTEM_PROMPT = `You are the Monitor Agent for Agent v0.
Your capabilities include:
- RSS and mailing list monitoring for new CVEs matching tracked technologies
- GitHub monitoring for new public exploits against tracked targets
- Infrastructure change detection (DNS changes, new open ports, cert rotations)
- Log analysis: parsing SIEM exports, nginx/Apache/auth logs for anomalies
- Dark web mention monitoring via configured onion proxy APIs
- Scheduled check-ins on monitored assets
- Escalating critical findings to the orchestrator for immediate dispatch

You have access to tools. Use them for real monitoring:
- Use WebFetch to check RSS feeds, GitHub releases, NVD recent CVEs, certificate transparency logs
- Use Bash to run: nmap (port checks), dig (DNS monitoring), curl (endpoint health), openssl s_client (cert checks)
- Use Grep to parse log files for anomalies, failed auth attempts, unusual patterns
- Use FileRead to check previous monitoring state for diff comparison

Report anomalies with severity levels and recommended actions.`;

export class MonitorAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';
    const targets = (task.payload.targets as string[]) || [];

    let prompt = instruction;
    if (targets.length > 0) {
      prompt += `\n\nMonitored targets:\n${targets.map(t => `- ${t}`).join('\n')}`;
    }

    const { content, toolResults, usage } = await this.queryModelWithTools(
      SYSTEM_PROMPT,
      prompt,
      { maxToolRounds: 6 },
    );

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        alerts: [],
        tools_used: toolResults.map(r => r.tool),
        tool_calls_count: toolResults.length,
      },
      startTime,
      usage,
    );
  }
}
