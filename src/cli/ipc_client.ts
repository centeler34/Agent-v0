/**
 * Lightweight IPC client for CLI → Daemon communication.
 */

import net from 'node:net';

interface IpcMessage {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

const DEFAULT_SOCKET = '/tmp/agent-v0.sock';

export async function sendIpcMessage(
  message: IpcMessage,
  socketPath: string = DEFAULT_SOCKET,
): Promise<IpcMessage | null> {
  return new Promise((resolve) => {
    const client = net.createConnection({ path: socketPath }, () => {
      const json = Buffer.from(JSON.stringify(message), 'utf-8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(json.length, 0);
      client.write(Buffer.concat([lenBuf, json]));
    });

    let buffer = Buffer.alloc(0);

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      if (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (buffer.length >= 4 + msgLen) {
          const jsonBuf = buffer.subarray(4, 4 + msgLen);
          const response: IpcMessage = JSON.parse(jsonBuf.toString('utf-8'));
          client.end();
          resolve(response);
        }
      }
    });

    client.on('error', () => {
      resolve(null);
    });

    client.setTimeout(10000, () => {
      client.end();
      resolve(null);
    });
  });
}
