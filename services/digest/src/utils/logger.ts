import winston from 'winston';
import { config } from '../config';

export const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${service || 'digest'}] ${level}: ${message}${metaStr}`;
    })
  ),
  defaultMeta: { service: 'digest' },
  transports: [new winston.transports.Console()],
});
