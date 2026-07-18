/**
 * Structured logger using Winston with daily rotate file transport.
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, '../../logs');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  if (stack) {
    return `${ts} [${level}] ${message}\n${stack}${metaStr}`;
  }
  return `${ts} [${level}] ${message}${metaStr}`;
});

/**
 * Create the Winston logger instance.
 */
export function createLogger(level = 'info') {
  return winston.createLogger({
    level,
    format: combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    ),
    transports: [
      // Console (colorized)
      new winston.transports.Console({
        format: combine(colorize(), logFormat),
      }),
      // Daily rotate file — all logs
      new DailyRotateFile({
        dirname: LOGS_DIR,
        filename: 'l2-monitor-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        level: 'debug',
      }),
      // Daily rotate file — errors only
      new DailyRotateFile({
        dirname: LOGS_DIR,
        filename: 'l2-monitor-error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
      }),
    ],
    exitOnError: false,
  });
}

// Singleton logger
let _logger = null;

export function getLogger(level) {
  if (!_logger) {
    _logger = createLogger(level);
  }
  return _logger;
}
