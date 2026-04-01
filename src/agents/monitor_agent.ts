/**
 * Monitor Agent — Continuous monitoring, alerting, and threat detection.
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
Report anomalies with severity levels and recommended actions.`;

export class MonitorAgent extends BaseAgent {
  protected async executeTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const instruction = (task.payload.instruction as string) || '';

    const { content, usage } = await this.queryModel(SYSTEM_PROMPT, instruction);

    return this.buildResult(
      task.task_id,
      {
        analysis: content,
        task_type: task.task_type,
        alerts: [],
      },
      startTime,
      usage,
    );
  }
}
