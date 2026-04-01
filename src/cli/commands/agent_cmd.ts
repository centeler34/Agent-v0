/**
 * `cyplex agent` subcommands.
 */

import type { Command } from 'commander';
import { sendIpcMessage } from '../ipc_client.js';
import { TaskRegistry } from '../../orchestrator/task_registry.js';

export function registerAgentCommands(program: Command, p0: TaskRegistry): void {
  const agent = program.command('agent').description('Manage agents');

  agent.command('list').description('List all agents').action(async () => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'agent_list', payload: {} });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
    else console.log('Daemon not running');
  });

  agent.command('info <agent-id>').description('Show agent details').action(async (agentId) => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'agent_info', payload: { agent_id: agentId } });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
  });

  agent.command('start <agent-id>').description('Start an agent').action(async (agentId) => {
    console.log(`Starting agent: ${agentId}`);
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'agent_start', payload: { agent_id: agentId } });
  });

  agent.command('stop <agent-id>').description('Stop an agent').action(async (agentId) => {
    console.log(`Stopping agent: ${agentId}`);
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'agent_stop', payload: { agent_id: agentId } });
  });

  agent.command('status').description('Show agent status grid').action(async () => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'agent_list', payload: {} });
    if (res?.payload?.agents) {
      const agents = res.payload.agents as any[];
      for (const a of agents) {
        const icon = a.state === 'idle' ? '●' : a.state === 'busy' ? '◉' : '○';
        console.log(`  ${icon} ${a.id.padEnd(20)} ${a.state}`);
      }
    }
  });
}
