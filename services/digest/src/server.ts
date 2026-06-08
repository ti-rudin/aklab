import express from 'express';
import { config } from './config';
import { logger } from './utils/logger';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'digest', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req, res) => {
  res.json({ status: 'ok', service: 'digest', timestamp: new Date().toISOString() });
});

export function startHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(config.port, '127.0.0.1', () => {
      logger.info(`Health server listening on 127.0.0.1:${config.port}`);
      resolve();
    });
  });
}
