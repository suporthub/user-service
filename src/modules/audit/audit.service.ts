import { prismaWrite } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface AuditLogEvent {
  userId:    string;
  userType:  string;
  eventType: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

/**
 * Persists an immutable audit log entry into the database.
 * Designed to gracefully catch and log errors to prevent Kafka consumer poison pills.
 */
export async function recordAuditLog(event: AuditLogEvent): Promise<void> {
  try {
    await prismaWrite.auditLog.create({
      data: {
        userId:    event.userId,
        userType:  event.userType,
        eventType: event.eventType,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        metadata:  event.metadata ?? null,
      },
    });
    logger.debug({ eventType: event.eventType, userId: event.userId }, 'Audit log recorded tightly to Postgres');
  } catch (error) {
    // CRITICAL: We explicitly swallow this error so a database blip doesn't crash 
    // the entire Kafka consumer processing loop for other legitimate messages.
    logger.error({ err: error, event }, 'CRITICAL: Failed to persist audit log to Postgres');
  }
}
