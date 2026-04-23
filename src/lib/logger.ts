import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';

// ── Ensure the logs directory exists on startup ───────────────────────────────
const logDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ── Transport targets ─────────────────────────────────────────────────────────
//
// SOLID / OCP: To add a cloud transport (Loki, Datadog, Axiom), append one
// entry to this array. Zero changes to business-logic code.
//
const targets: pino.TransportTargetOptions[] = [];

if (config.nodeEnv !== 'production') {
  // Dev: human-readable colourised output to stdout
  targets.push({
    target:  'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    level:   'debug',
  });
} else {
  // Production: plain JSON to stdout — captured by Docker log driver / systemd
  targets.push({
    target:  'pino/file',
    options: { destination: 1 }, // fd 1 = stdout
    level:   'info',
  });
}

// File transport (local disk) — active when LOG_TO_FILE=true
// Rotation: daily file roll, 30-day retention, 100 MB per-file cap.
// Phase 2 migration: add pino-loki / pino-datadog target here; delete this block.
if (config.logToFile) {
  targets.push({
    target:  'pino-roll',
    options: {
      file:      path.join(logDir, `${config.serviceName}.log`),
      frequency: 'daily',
      limit:     { count: 30 },   // keep 30 daily files
      size:      '100m',          // roll early if a single file exceeds 100 MB
    },
    level: 'debug',
  });
}

// ── Logger instance ───────────────────────────────────────────────────────────
// `service` is stamped on every log line — essential for log aggregation.
export const logger = pino(
  {
    level: config.logLevel,
    base:  { service: config.serviceName },
  },
  pino.transport({ targets }),
);
