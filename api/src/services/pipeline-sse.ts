/**
 * Pipeline SSE — Server-Sent Events connection manager.
 *
 * Клиенты подключаются через GET /pipeline/stream.
 * Pipeline broadcastSSE() отправляет события всем подключённым.
 */

import type { PipelineState } from './pipeline';

type SSEClient = {
  id: string;
  res: any; // Koa response object
};

const clients = new Map<string, SSEClient>();
let nextId = 0;

/**
 * Register a new SSE client. Returns cleanup function.
 */
export function registerSSEClient(res: any): () => void {
  const id = String(++nextId);
  const client: SSEClient = { id, res };
  clients.set(id, client);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx proxy buffering off

  // Send initial ping
  res.write(`event: connected\ndata: {"id":"${id}"}\n\n`);

  // Cleanup on disconnect
  res.on('close', () => {
    clients.delete(id);
  });

  return () => {
    clients.delete(id);
    try { res.end(); } catch { /* already closed */ }
  };
}

/**
 * Broadcast an SSE event to all connected clients.
 */
export function broadcastSSE(event: string, data: any): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected, clean up
      clients.delete(id);
    }
  }
}

/**
 * Get number of connected SSE clients (for debugging).
 */
export function getSSEClientCount(): number {
  return clients.size;
}
