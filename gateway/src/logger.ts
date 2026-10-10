import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level = process.env.LOG_LEVEL): Logger {
  const fallback = process.env.NODE_ENV === 'test' ? 'silent' : 'info';
  return pino({ level: level ?? fallback, base: { service: 'gateway' } });
}

export const silentLogger: Logger = pino({ level: 'silent' });
