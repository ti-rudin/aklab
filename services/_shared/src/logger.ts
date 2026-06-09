/**
 * Winston logger для микросервисов.
 * Имя сервиса берётся из SERVICE_NAME.
 */

import winston from 'winston';
import { config } from './config';

export const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${config.serviceName}] ${level}: ${message}${metaStr}`;
    })
  ),
  defaultMeta: { service: config.serviceName },
  transports: [new winston.transports.Console()],
});
