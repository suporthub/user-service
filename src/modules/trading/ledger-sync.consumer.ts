import { prismaWrite } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { Prisma } from '@prisma/client';

export interface OrderExecutedEvent {
  ticket_id: string;
  user_id: string;
  user_type?: string;
  commission_charged: number;
}

export interface OrderClosedEvent {
  ticket_id: string;
  user_id: string;
  user_type?: string;
  realized_pnl: number;
}

/**
 * Handles the 'orders.executed' Kafka event to deduct the commission from the user's wallet.
 */
export async function handleOrderExecuted(event: OrderExecutedEvent): Promise<void> {
  const { ticket_id, user_id, commission_charged } = event;
  const user_type = event.user_type || 'live'; // Fallback to 'live' if not provided by Go execution engine

  if (!ticket_id || !user_id || typeof commission_charged !== 'number') {
    logger.warn({ event }, '[ledger-sync.consumer] Malformed orders.executed event — skipping');
    return;
  }

  // If there's no commission, there's nothing to deduct
  if (commission_charged === 0) {
    return;
  }

  try {
    await prismaWrite.$transaction(async (tx) => {
      // 1. Enforce Idempotency via LedgerTransaction creation
      await tx.ledgerTransaction.create({
        data: {
          ticketId: ticket_id,
          userId: user_id,
          userType: user_type,
          eventType: 'COMMISSION_DEDUCTION',
          amount: new Prisma.Decimal(commission_charged),
        },
      });

      // 2. Safely deduct the commission using atomic decrement
      // Note: If commission_charged is positive from Go, we must subtract it.
      if (user_type === 'live') {
        await tx.liveUser.update({
          where: { id: user_id },
          data: {
            walletBalance: { decrement: commission_charged },
          },
        });
      } else if (user_type === 'demo') {
        await tx.demoUser.update({
          where: { id: user_id },
          data: {
            demoBalance: { decrement: commission_charged },
          },
        });
      } else {
        logger.warn({ ticket_id, user_type }, '[ledger-sync.consumer] Unknown user_type for commission deduction');
      }

      logger.info({ ticket_id, user_id, commission_charged, user_type }, '[ledger-sync.consumer] Successfully deducted open commission');
    });
  } catch (error: any) {
    // If it's a Prisma unique constraint violation (P2002), the event was already processed
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.info({ ticket_id, eventType: 'COMMISSION_DEDUCTION' }, '[ledger-sync.consumer] Event already processed (idempotent skip)');
      return;
    }
    
    // Log any other errors and re-throw
    logger.error({ error, ticket_id, user_id }, '[ledger-sync.consumer] Failed to process COMMISSION_DEDUCTION');
    throw error;
  }
}

/**
 * Handles the 'orders.closed' Kafka event to settle the realized PnL to the user's wallet.
 */
export async function handleOrderClosed(event: OrderClosedEvent): Promise<void> {
  const { ticket_id, user_id, realized_pnl } = event;
  const user_type = event.user_type || 'live'; // Fallback to 'live' if not provided by Go execution engine

  if (!ticket_id || !user_id || typeof realized_pnl !== 'number') {
    logger.warn({ event }, '[ledger-sync.consumer] Malformed orders.closed event — skipping');
    return;
  }

  // If PnL is exactly 0, there is nothing to update (some edge cases or break-even closures)
  if (realized_pnl === 0) {
    return;
  }

  try {
    await prismaWrite.$transaction(async (tx) => {
      // 1. Enforce Idempotency via LedgerTransaction creation
      await tx.ledgerTransaction.create({
        data: {
          ticketId: ticket_id,
          userId: user_id,
          userType: user_type,
          eventType: 'PNL_SETTLEMENT',
          amount: new Prisma.Decimal(realized_pnl),
        },
      });

      // 2. Safely settle the realized PnL using atomic increment
      // Note: realized_pnl can be positive (profit) or negative (loss). Increment works for both.
      if (user_type === 'live') {
        await tx.liveUser.update({
          where: { id: user_id },
          data: {
            walletBalance: { increment: realized_pnl },
          },
        });
      } else if (user_type === 'demo') {
        await tx.demoUser.update({
          where: { id: user_id },
          data: {
            demoBalance: { increment: realized_pnl },
          },
        });
      } else {
        logger.warn({ ticket_id, user_type }, '[ledger-sync.consumer] Unknown user_type for PnL settlement');
      }

      logger.info({ ticket_id, user_id, realized_pnl, user_type }, '[ledger-sync.consumer] Successfully settled realized PnL');
    });
  } catch (error: any) {
    // If it's a Prisma unique constraint violation (P2002), the event was already processed
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.info({ ticket_id, eventType: 'PNL_SETTLEMENT' }, '[ledger-sync.consumer] Event already processed (idempotent skip)');
      return;
    }
    
    // Log any other errors and re-throw
    logger.error({ error, ticket_id, user_id }, '[ledger-sync.consumer] Failed to process PNL_SETTLEMENT');
    throw error;
  }
}
