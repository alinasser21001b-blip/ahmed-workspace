import { pino, type Logger } from 'pino';
import { getConfig } from './config.js';

/**
 * Structured logging (§82).
 *
 * JSON in production so logs are queryable; pretty in development so they are
 * readable. Redaction is configured centrally rather than left to call sites,
 * because a secret only has to be logged once.
 */

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'token_hash',
  'AI_API_KEY',
  'JWT_SECRET',
];

let root: Logger | null = null;

export function getLogger(): Logger {
  if (root) return root;
  const { env, isProduction, isTest } = getConfig();

  root = pino({
    level: isTest ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: 'sos-api', env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
          },
        }),
  });

  return root;
}

/** Test seam. */
export function resetLogger(): void {
  root = null;
}
