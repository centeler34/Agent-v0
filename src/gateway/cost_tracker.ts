/**
 * Token usage and cost tracking across agents and providers.
 */

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface AgentUsageRecord {
  provider: string;
  usage: TokenUsage;
  cost: number;
  timestamp: number;
}

/**
 * Simple per-provider cost model (USD per 1 000 tokens).
 * Rates are rough averages — adjust as pricing changes.
 */
const COST_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
  anthropic: { prompt: 0.003, completion: 0.015 },
  openai: { prompt: 0.003, completion: 0.006 },
  gemini: { prompt: 0.00025, completion: 0.0005 },
  mistral: { prompt: 0.001, completion: 0.003 },
};

export class CostTracker {
  private records: AgentUsageRecord[] = [];
  private agentRecords: Map<string, AgentUsageRecord[]> = new Map();

  /**
   * Record a completed request's token usage.
   */
  recordUsage(agentId: string, provider: string, usage: TokenUsage): void {
    const cost = this.calculateCost(provider, usage);
    const record: AgentUsageRecord = {
      provider,
      usage,
      cost,
      timestamp: Date.now(),
    };

    this.records.push(record);

    let agentList = this.agentRecords.get(agentId);
    if (!agentList) {
      agentList = [];
      this.agentRecords.set(agentId, agentList);
    }
    agentList.push(record);
  }

  /**
   * Total cost across all agents for the current session.
   */
  getSessionCost(): number {
    return this.records.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * Total cost for a specific agent.
   */
  getAgentCost(agentId: string): number {
    const agentList = this.agentRecords.get(agentId);
    if (!agentList) return 0;
    return agentList.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * Per-agent breakdown of total tokens and cost.
   */
  getCostBreakdown(): Record<string, { tokens: number; cost: number }> {
    const breakdown: Record<string, { tokens: number; cost: number }> = {};

    for (const [agentId, records] of this.agentRecords.entries()) {
      let totalTokens = 0;
      let totalCost = 0;

      for (const r of records) {
        totalTokens += r.usage.total_tokens;
        totalCost += r.cost;
      }

      breakdown[agentId] = { tokens: totalTokens, cost: totalCost };
    }

    return breakdown;
  }

  /**
   * Total token usage across all agents.
   */
  getTotalTokens(): number {
    return this.records.reduce((sum, r) => sum + r.usage.total_tokens, 0);
  }

  private calculateCost(provider: string, usage: TokenUsage): number {
    const rates = COST_PER_1K_TOKENS[provider];
    if (!rates) return 0;

    const promptCost = (usage.prompt_tokens / 1000) * rates.prompt;
    const completionCost = (usage.completion_tokens / 1000) * rates.completion;

    return promptCost + completionCost;
  }
}
