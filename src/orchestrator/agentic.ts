/**
 * Agentic — Top-level orchestrator.
 * Receives user intent, decomposes into subtasks, delegates to subordinate agents, 
 * Receives user intent, decomposes into subtasks, delegates to subordinate agents, 
 * and synthesizes results.
 */

import crypto from 'node:crypto';
import { TaskRegistry } from './task_registry.js';
import { DependencyResolver } from './dependency_resolver.js';
import { ResultSynthesizer } from './result_synthesizer.js';
import { MemoryManager } from './memory_manager.js';
import { LSPBridge } from '../security/lsp_bridge.js';
import { IntentParser, type ParsedIntent } from './intent_parser.js';
import type {
  TaskEnvelope,
  ResultEnvelope,
  Priority,
  SourceChannel,
} from '../types/task_envelope.js';
import type { GatewayRouter } from '../gateway/gateway.js';

function generateId(): string {
  return crypto.randomUUID();
}

export interface AgenticConfig {
  maxConcurrentDelegations: number;
  defaultTimeoutMs: number;
  modelOverride?: string;
}

type AgentDispatcher = (agentId: string, task: TaskEnvelope) => Promise<ResultEnvelope>;
export type OutputHandler = (taskId: string, agentId: string, text: string) => void;

export class Agentic {
  private config: AgenticConfig;
  private taskRegistry: TaskRegistry;
  private depResolver: DependencyResolver;
  private synthesizer: ResultSynthesizer;
  private intentParser: IntentParser;
  private memoryManager: MemoryManager;
  private lspBridge: LSPBridge;
  private dispatcher: AgentDispatcher | null = null;
  private gateway: GatewayRouter | null = null;
  private outputHandler: OutputHandler | null = null;

  constructor(config: AgenticConfig) {
    this.config = config;
    this.taskRegistry = new TaskRegistry();
    this.depResolver = new DependencyResolver();
    this.synthesizer = new ResultSynthesizer();
    this.intentParser = new IntentParser();
    this.memoryManager = new MemoryManager(this.taskRegistry);
    this.lspBridge = new LSPBridge();
  }

  setDispatcher(dispatcher: AgentDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setGateway(gateway: GatewayRouter): void {
    this.gateway = gateway;
  }

  /**
   * Sets a callback for real-time task output.
   */
  onTaskOutput(handler: OutputHandler): void {
    this.outputHandler = handler;
  }

  /**
   * Relays output from a subordinate agent back to the orchestrator.
   */
  emitOutput(taskId: string, agentId: string, text: string): void {
    if (this.outputHandler) {
      this.outputHandler(taskId, agentId, text);
    }
  }

  /**
   * Main entry point: receive user input, decompose, delegate, synthesize.
   */
  async handleInput(
    input: string,
    sourceChannel: SourceChannel = 'cli',
    priority: Priority = 'medium',
  ): Promise<ResultEnvelope> {
    const rootTaskId = generateId();

    // Parse user intent into structured plan
    const intent = await this.intentParser.parse(input);

    // Build memory context to inform agents
    const memoryContext = this.memoryManager.buildMemoryPrompt();

    // Create root task
    const rootTask: TaskEnvelope = {
      task_id: rootTaskId,
      parent_task_id: null,
      source_agent: 'agentic',
      target_agent: 'agentic',
      task_type: 'orchestrate',
      payload: { raw_input: input, intent },
      context: { system_memory: memoryContext },
      priority,
      deadline_ms: this.config.defaultTimeoutMs,
      created_at: new Date().toISOString(),
      source_channel: sourceChannel,
    };

    this.taskRegistry.register(rootTask);

    // Decompose into subtasks based on parsed intent
    const subtasks = this.decompose(intent, rootTaskId, sourceChannel, priority, memoryContext);

    // Register all subtasks
    for (const task of subtasks) {
      this.taskRegistry.register(task);
    }

    // Resolve execution order based on dependencies
    const executionPlan = this.depResolver.resolve(
      subtasks.map((t) => ({
        taskId: t.task_id,
        dependencies: [], // Intent parser determines dependencies
        agent: t.target_agent,
      })),
    );

    // Execute subtasks in dependency order
    const results: ResultEnvelope[] = [];
    for (const batch of executionPlan) {
      const batchResults = await Promise.all(
        batch.map((taskId) => {
          const task = subtasks.find((t) => t.task_id === taskId);
          if (!task) throw new Error(`Task ${taskId} not found in decomposition`);
          return this.delegateTask(task);
        }),
      );
      results.push(...batchResults);
    }

    // Synthesize results
    const finalResult = this.synthesizer.synthesize(rootTaskId, results);

    // Learning Phase: Auto-save successful patterns
    if (finalResult.status === 'success') {
      await this.learnFromResults(results);
    }

    // Mark root task complete
    this.taskRegistry.updateStatus(rootTaskId, finalResult.status);

    return finalResult;
  }

  /**
   * Analyzes subtask results to extract and learn successful patterns.
   */
  private async learnFromResults(results: ResultEnvelope[]): Promise<void> {
    for (const res of results) {
      if (res.status === 'success' && res.output && typeof res.output === 'object') {
        const output = res.output as any;
        // Auto-learn successful command patterns
        if (output.command) {
          await this.memoryManager.learnSuccessfulPattern(
            res.agent_id,
            'command_execution',
            output.command
          );
        }
        // Validate code results via LSPBridge - ported from tools/utils/hooks.ts logic
        if (output.code && output.language) {
          const check = this.lspBridge.checkSyntax(output.language, output.code);
          if (!check.valid) {
            this.emitOutput(res.task_id, 'agentic', `[LSP Warning] Syntax error detected: ${check.errors[0]}`);
          }
        }
      }
    }
  }

  /**
   * Decompose a parsed intent into concrete subtasks.
   */
  private decompose(
    intent: ParsedIntent,
    parentTaskId: string,
    sourceChannel: SourceChannel,
    priority: Priority,
    memoryContext: string,
  ): TaskEnvelope[] {
    return intent.subtasks.map((subtask) => ({
      task_id: generateId(),
      parent_task_id: parentTaskId,
      source_agent: 'agentic',
      target_agent: subtask.agent,
      task_type: subtask.type,
      payload: subtask.payload,
      context: { ...(subtask.context || {}), system_memory: memoryContext },
      priority,
      deadline_ms: subtask.timeoutMs || this.config.defaultTimeoutMs,
      created_at: new Date().toISOString(),
      source_channel: sourceChannel,
    }));
  }

  /**
   * Delegate a task to a subordinate agent and wait for the result.
   */
  private async delegateTask(task: TaskEnvelope): Promise<ResultEnvelope> {
    if (!this.dispatcher) {
      return {
        task_id: task.task_id,
        agent_id: task.target_agent,
        status: 'failed',
        output: {},
        artifacts: [],
        duration_ms: 0,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        completed_at: new Date().toISOString(),
        error: 'No dispatcher configured',
      };
    }

    this.taskRegistry.updateStatus(task.task_id, 'running');

    const startTime = Date.now();
    try {
      const result = await Promise.race([
        this.dispatcher(task.target_agent, task),
        this.timeoutPromise(task.deadline_ms, task.task_id, task.target_agent),
      ]);

      this.taskRegistry.updateStatus(task.task_id, result.status);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.taskRegistry.updateStatus(task.task_id, 'failed');

      return {
        task_id: task.task_id,
        agent_id: task.target_agent,
        status: 'failed',
        output: {},
        artifacts: [],
        duration_ms: duration,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        completed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private timeoutPromise(ms: number, taskId: string, agentId: string): Promise<ResultEnvelope> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Task ${taskId} timed out after ${ms}ms (agent: ${agentId})`)), ms);
    });
  }

  getTaskRegistry(): TaskRegistry {
    return this.taskRegistry;
  }
}
