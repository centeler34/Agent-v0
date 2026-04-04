/**
 * BaseAgent — Abstract base class for all subordinate agents.
 * Provides message queue handling, audit logging, skill execution, and workspace management.
 */

import type { TaskEnvelope, ResultEnvelope, TokenUsage } from '../types/task_envelope.js';
import type { AgentConfig, AgentRole, AgentState } from '../types/agent_config.js';
import type { ModelClient } from '../gateway/model_client.js';
import { AgentToolkit } from '../tools/agent_toolkit.js';

export abstract class BaseAgent {
  readonly id: AgentRole;
  protected config: AgentConfig;
  protected state: AgentState = 'idle';
  protected modelClient: ModelClient | null = null;
  protected toolkit: AgentToolkit;
  protected activeTasks: Map<string, TaskEnvelope> = new Map();
  protected totalCompleted = 0;
  protected totalFailed = 0;
  protected startedAt: Date;
  protected tokenUsage: TokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  };

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.config = config;
    this.toolkit = new AgentToolkit(config.id, config.workspace);
    this.startedAt = new Date();
  }

  setModelClient(client: ModelClient): void {
    this.modelClient = client;
  }

  getState(): AgentState {
    return this.state;
  }

  /**
   * Handle an incoming task from Agentic.
   */
  async handleTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    this.state = 'busy';
    this.activeTasks.set(task.task_id, task);
    const startTime = Date.now();

    try {
      const result = await this.executeTask(task);
      this.totalCompleted++;
      this.activeTasks.delete(task.task_id);
      this.state = this.activeTasks.size > 0 ? 'busy' : 'idle';
      return result;
    } catch (error) {
      this.totalFailed++;
      this.activeTasks.delete(task.task_id);
      this.state = this.activeTasks.size > 0 ? 'busy' : 'idle';

      return {
        task_id: task.task_id,
        agent_id: this.id,
        status: 'failed',
        output: {},
        artifacts: [],
        duration_ms: Date.now() - startTime,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        completed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Subclasses implement their specific task logic here.
   */
  protected abstract executeTask(task: TaskEnvelope): Promise<ResultEnvelope>;

  /**
   * Build a successful result envelope.
   */
  protected buildResult(
    taskId: string,
    output: Record<string, unknown>,
    startTime: number,
    usage?: Partial<TokenUsage>,
  ): ResultEnvelope {
    const tokenUsage: TokenUsage = {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      completion_tokens: usage?.completion_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
      estimated_cost_usd: usage?.estimated_cost_usd ?? 0,
    };

    this.tokenUsage.prompt_tokens += tokenUsage.prompt_tokens;
    this.tokenUsage.completion_tokens += tokenUsage.completion_tokens;
    this.tokenUsage.total_tokens += tokenUsage.total_tokens;
    this.tokenUsage.estimated_cost_usd += tokenUsage.estimated_cost_usd;

    return {
      task_id: taskId,
      agent_id: this.id,
      status: 'success',
      output,
      artifacts: [],
      duration_ms: Date.now() - startTime,
      token_usage: tokenUsage,
      completed_at: new Date().toISOString(),
    };
  }

  /**
   * Send a prompt to the AI model and return the response.
   */
  /**
   * Send a prompt to the AI model and return the response.
   * Automatically injects available tool descriptions into the system prompt.
   */
  protected async queryModel(systemPrompt: string, userPrompt: string): Promise<{ content: string; usage: TokenUsage }> {
    if (!this.modelClient) {
      throw new Error(`Agent ${this.id} has no model client configured`);
    }

    const toolContext = this.toolkit.describeTools();
    const augmentedSystem = `${systemPrompt}\n\n${toolContext}\n\nWhen you need to interact with the filesystem, run commands, or fetch data, output a <tool_call> block:\n<tool_call tool="ToolName">\n{"param": "value"}\n</tool_call>\n\nThe orchestrator will execute the tool and return results.`;

    const response = await this.modelClient.complete({
      messages: [
        { role: 'system', content: augmentedSystem },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.3,
      stream: false,
    });

    return {
      content: response.content,
      usage: {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        estimated_cost_usd: 0,
      },
    };
  }

  /**
   * Execute a model query with tool-use loop.
   * The model can request tool calls in its response; this method parses them,
   * executes them via the toolkit, and feeds results back until the model
   * produces a final answer with no more tool calls.
   */
  protected async queryModelWithTools(
    systemPrompt: string,
    userPrompt: string,
    opts?: { maxToolRounds?: number },
  ): Promise<{ content: string; toolResults: Array<{ tool: string; result: import('../tools/tool_runtime.js').ToolResult }>; usage: TokenUsage }> {
    const maxRounds = opts?.maxToolRounds ?? 10;
    const toolResults: Array<{ tool: string; result: import('../tools/tool_runtime.js').ToolResult }> = [];
    const cumulativeUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };

    let conversationHistory = userPrompt;

    for (let round = 0; round < maxRounds; round++) {
      const { content, usage } = await this.queryModel(systemPrompt, conversationHistory);
      cumulativeUsage.prompt_tokens += usage.prompt_tokens;
      cumulativeUsage.completion_tokens += usage.completion_tokens;
      cumulativeUsage.total_tokens += usage.total_tokens;

      // Parse tool calls from model output
      const toolCallRegex = /<tool_call\s+tool="(\w+)">\s*([\s\S]*?)\s*<\/tool_call>/g;
      const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
      let match;
      while ((match = toolCallRegex.exec(content)) !== null) {
        try {
          calls.push({ tool: match[1], params: JSON.parse(match[2]) });
        } catch {
          // skip malformed tool calls
        }
      }

      if (calls.length === 0) {
        // No tool calls — model has produced its final answer
        return { content, toolResults, usage: cumulativeUsage };
      }

      // Execute each tool call and collect results
      const roundResults: string[] = [];
      for (const call of calls) {
        const result = this.dispatchToolCall(call.tool, call.params);
        toolResults.push({ tool: call.tool, result: result instanceof Promise ? await result : result });
        const resolved = result instanceof Promise ? await result : result;
        roundResults.push(`<tool_result tool="${call.tool}" success="${resolved.success}">\n${resolved.output}${resolved.error ? '\nError: ' + resolved.error : ''}\n</tool_result>`);
      }

      // Feed results back into the conversation for the next round
      conversationHistory = `${userPrompt}\n\nPrevious model output:\n${content}\n\nTool results:\n${roundResults.join('\n\n')}\n\nContinue your analysis using the tool results above.`;
    }

    // Exhausted rounds — return last content
    const { content, usage } = await this.queryModel(systemPrompt, conversationHistory);
    cumulativeUsage.prompt_tokens += usage.prompt_tokens;
    cumulativeUsage.completion_tokens += usage.completion_tokens;
    cumulativeUsage.total_tokens += usage.total_tokens;
    return { content, toolResults, usage: cumulativeUsage };
  }

  /**
   * Dispatch a single tool call to the appropriate toolkit method.
   */
  private dispatchToolCall(
    tool: string,
    params: Record<string, unknown>,
  ): import('../tools/tool_runtime.js').ToolResult | Promise<import('../tools/tool_runtime.js').ToolResult> {
    switch (tool) {
      case 'Bash':
        return this.toolkit.bash(params.command as string, { timeout_ms: params.timeout_ms as number | undefined });
      case 'Grep':
        return this.toolkit.grep(params.pattern as string, {
          path: params.path as string | undefined,
          glob: params.glob as string | undefined,
          type: params.type as string | undefined,
          case_insensitive: params.case_insensitive as boolean | undefined,
          max_results: params.max_results as number | undefined,
          output_mode: params.output_mode as 'content' | 'files_with_matches' | 'count' | undefined,
          context_lines: params.context_lines as number | undefined,
        });
      case 'Glob':
        return this.toolkit.glob(params.pattern as string, { max_results: params.max_results as number | undefined });
      case 'FileRead':
        return this.toolkit.readFile(params.filePath as string || params.file_path as string, {
          offset: params.offset as number | undefined,
          limit: params.limit as number | undefined,
        });
      case 'FileWrite':
        return this.toolkit.writeFile(params.filePath as string || params.file_path as string, params.content as string);
      case 'FileEdit':
        return this.toolkit.editFile(
          params.filePath as string || params.file_path as string,
          params.oldString as string || params.old_string as string,
          params.newString as string || params.new_string as string,
          { replace_all: params.replace_all as boolean | undefined },
        );
      case 'WebFetch':
        return this.toolkit.webFetch(params.url as string, { timeout_ms: params.timeout_ms as number | undefined });
      default:
        return { success: false, output: '', error: `Unknown tool: ${tool}`, duration_ms: 0 };
    }
  }

  getStatus() {
    return {
      id: this.id,
      state: this.state,
      current_tasks: Array.from(this.activeTasks.keys()),
      total_tasks_completed: this.totalCompleted,
      total_tasks_failed: this.totalFailed,
      uptime_ms: Date.now() - this.startedAt.getTime(),
      token_usage: {
        session_total: this.tokenUsage.total_tokens,
        budget_remaining: this.config.rate_limit.tokens_per_minute,
      },
      last_heartbeat: new Date().toISOString(),
    };
  }
}
