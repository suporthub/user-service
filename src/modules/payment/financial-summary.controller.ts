// ─────────────────────────────────────────────────────────────────────────────
// financial-summary.controller.ts  (user-service)
//
// GET /internal/financial/summary?timeframe=today|week|month|all
//
// Called internally by auth-service (x-service-secret) and proxied to the
// frontend as GET /api/financial/summary.
//
// Returns:
//   deposit  — sum of completed CREDIT deposit transactions in the date range
//   balance  — current walletBalance snapshot from LiveUser (always live)
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prismaRead } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { parseTimeframe } from '../../utils/timeframe';
import type { Prisma } from '@prisma/client';

// ── Response shape ────────────────────────────────────────────────────────────

export interface FinancialSummaryResponse {
  deposit: number;
  balance: number;
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * GET /internal/financial/summary?timeframe=&userId=
 *
 * The userId is passed as a query param by auth-service (it carries the
 * trading account UUID from the JWT — that is the LiveUser.id).
 */
export const getFinancialSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    // auth-service forwards the authenticated account ID as a query param
    // so this endpoint stays stateless and easy to test.
    const userId   = req.query['userId']   as string | undefined;
    const timeframe = (req.query['timeframe'] as string | undefined) ?? 'today';

    if (!userId) {
      res.status(400).json({ success: false, message: 'userId query param is required' });
      return;
    }

    const { startDate, endDate } = parseTimeframe(timeframe);

    // ── Date filter for createdAt ─────────────────────────────────────────────
    const dateFilter: Prisma.UserTransactionWhereInput =
      startDate && endDate
        ? { createdAt: { gte: startDate, lte: endDate } }
        : {};

    // ── Parallel queries — no data dependency between them ───────────────────
    //
    // Query 1: Sum of completed CREDIT deposit transactions in the date range.
    //          amount is always positive; direction makes the intent explicit.
    //
    // Query 2: Current wallet balance snapshot from LiveUser.
    //          Intentionally NOT date-filtered — walletBalance is a running
    //          denormalised cache of the current state, not a historic sum.
    //          Consistent with MT5's "Balance" field behaviour.
    const [depositAggregate, liveUser] = await Promise.all([
      prismaRead.userTransaction.aggregate({
        _sum: { amount: true },
        where: {
          userId,
          txnType:   'deposit',
          direction: 'CREDIT',
          status:    'completed',
          ...dateFilter,
        },
      }),
      prismaRead.liveUser.findUnique({
        where:  { id: userId },
        select: { walletBalance: true },
      }),
    ]);

    const deposit = Number(depositAggregate._sum.amount ?? 0);
    const balance = Number(liveUser?.walletBalance ?? 0);

    const response: FinancialSummaryResponse = { deposit, balance };
    res.json(response);
  } catch (err) {
    logger.error({ err }, 'Error computing financial summary');
    res.status(500).json({ success: false, message: 'Failed to compute financial summary' });
  }
};
