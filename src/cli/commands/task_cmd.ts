/**
 * `cyplex task` subcommands.
 */

import crypto from 'node:crypto'; // Added for crypto.randomUUID()
import type { Command } from 'commander';
import { sendIpcMessage } from '../ipc_client.js';

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Manage tasks');

  task
    .command('submit <input>')
    .description('Submit a task to Agentic')
    .option('--agent <id>', 'Submit directly to a specific agent')
    .option('--priority <level>', 'Task priority (critical/high/medium/low)', 'medium')
    .option('--context <file>', 'Path to context file')
    .option('--pipeline <agents>', 'Comma-separated agent pipeline')
    .option('--batch <file>', 'Batch submit from YAML file')
    .option('--output <format>', 'Output format (json/yaml/text)', 'text')
    .action(async (input, opts) => {
      const res = await sendIpcMessage({
        id: crypto.randomUUID(),
        type: 'task_submit',
        payload: {
          task_id: crypto.randomUUID(),
          input,
          agent: opts.agent,
          priority: opts.priority,
          pipeline: opts.pipeline?.split(','),
          output_format: opts.output,
        },
      });
      if (res) console.log(JSON.stringify(res.payload, null, 2));
    });

  task.command('status <task-id>').description('Check task status').action(async (taskId) => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'task_status', payload: { task_id: taskId } });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
  });

  task.command('cancel <task-id>').description('Cancel a running task').action(async (taskId) => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'task_cancel', payload: { task_id: taskId } });
    console.log(`Task ${taskId} cancelled`);
  });

  task.command('list').description('List all tasks').option('--status <status>', 'Filter by status').action(async (opts) => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'task_list', payload: { status: opts.status } });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
  });

  task.command('inspect <task-id>').description('Inspect task details').action(async (taskId) => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'task_inspect', payload: { task_id: taskId } });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
  });

  task.command('retry <task-id>').description('Retry a failed task').action(async (taskId) => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'task_retry', payload: { task_id: taskId } });
    console.log(`Task ${taskId} retrying`);
  });
}
