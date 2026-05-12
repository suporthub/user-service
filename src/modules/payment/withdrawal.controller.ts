import { Request, Response } from 'express';
import { prismaWrite } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { publishEvent } from '../../lib/kafka';
import { getPortfolioSummary } from '../../grpc/execution-client';
import { v4 as uuidv4 } from 'uuid';

function generateTxnRef(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
  return `TXN-${date}-${rand}`;
}

/**
 * requestWithdrawal - User facing API to request a withdrawal
 */
export const requestWithdrawal = async (req: Request, res: Response): Promise<void> => {
  const { tradingAccountId, amount, paymentMethodId } = req.body as {
    tradingAccountId: string;
    amount: number;
    paymentMethodId: string;
  };

  if (!tradingAccountId || typeof amount !== 'number' || amount <= 0 || !paymentMethodId) {
    res.status(400).json({ success: false, message: 'Invalid input parameters' });
    return;
  }

  // 1. Get Free Margin from execution-service via gRPC
  let portfolio;
  try {
    portfolio = await getPortfolioSummary({ user_id: tradingAccountId });
  } catch (err) {
    logger.error({ err, tradingAccountId }, 'Failed to fetch portfolio from execution-service');
    res.status(500).json({ success: false, message: 'Failed to verify account margin' });
    return;
  }

  if (amount > portfolio.free_margin) {
    res.status(400).json({ success: false, message: 'Insufficient Free Margin' });
    return;
  }

  // 2. Execute DB Transaction
  const txn = await prismaWrite.$transaction(async (tx) => {
    const user = await tx.liveUser.findUnique({
      where: { id: tradingAccountId },
      select: { id: true, walletBalance: true, currency: true },
    });

    if (!user) throw new Error('Account not found');

    const paymentMethod = await tx.userPaymentMethod.findUnique({
      where: { id: paymentMethodId },
    });

    if (!paymentMethod || paymentMethod.userId !== user.id) {
      throw new Error('Invalid payment method');
    }

    const balanceBefore = Number(user.walletBalance);
    // Double check balance as an extra safety measure, even though free_margin checked
    if (balanceBefore < amount) {
      throw new Error('Insufficient wallet balance');
    }

    const balanceAfter = Number((balanceBefore - amount).toFixed(6));
    const txnId = uuidv4();

    const newTxn = await tx.userTransaction.create({
      data: {
        id: txnId,
        userId: user.id,
        userType: 'live',
        tradingAccountId: user.id,
        txnType: 'withdrawal',
        direction: 'DEBIT',
        amount: amount,
        currency: user.currency,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        txnRef: generateTxnRef(),
        description: `Withdrawal Request to ${paymentMethod.label}`,
        status: 'pending',
        paymentMethodId: paymentMethod.id,
      },
    });

    await tx.liveUser.update({
      where: { id: user.id },
      data: { walletBalance: balanceAfter },
    });

    return newTxn;
  });

  // 3. Publish to Kafka AFTER DB Commit
  await publishEvent('wallet.transactions', txn.id, {
    user_id: tradingAccountId,
    transaction_type: 'WITHDRAWAL',
    amount: amount,
  }).catch(err => {
    logger.error({ err, txnId: txn.id }, 'Failed to publish wallet decrement to Kafka');
  });

  res.json({ success: true, data: txn });
};


/**
 * processWithdrawal - Internal API called by admin-service to approve or reject a withdrawal
 */
export const processWithdrawal = async (req: Request, res: Response): Promise<void> => {
  const { transactionId, action, adminId, gatewayTxnId, rejectionReason } = req.body as {
    transactionId: string;
    action: 'approve' | 'reject';
    adminId: string;
    gatewayTxnId?: string;
    rejectionReason?: string;
  };

  if (!transactionId || !['approve', 'reject'].includes(action) || !adminId) {
    res.status(400).json({ success: false, message: 'Invalid input parameters' });
    return;
  }

  // 1. Execute DB Transaction
  const resultTxn = await prismaWrite.$transaction(async (tx) => {
    const txn = await tx.userTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!txn) {
      throw new Error('Transaction not found');
    }

    // Architectural Guard 1: The "Double-Click" Refund Bug Guard
    if (txn.status !== 'pending') {
      throw new Error(`Transaction is already ${txn.status}. Cannot process.`);
    }

    if (action === 'approve') {
      return await tx.userTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'completed',
          approvedBy: adminId,
          approvedAt: new Date(),
          gatewayTxnId: gatewayTxnId || null,
        },
      });
    } else {
      // Reject Action
      const updatedTxn = await tx.userTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: rejectionReason || null,
        },
      });

      const user = await tx.liveUser.findUnique({
        where: { id: txn.tradingAccountId! },
        select: { id: true, walletBalance: true },
      });

      if (!user) throw new Error('Associated trading account not found for refund');

      const refundedBalance = Number(user.walletBalance) + Number(txn.amount);

      await tx.liveUser.update({
        where: { id: user.id },
        data: { walletBalance: refundedBalance },
      });

      return updatedTxn;
    }
  });

  // 2. Publish to Kafka AFTER DB Commit if rejected (Refund)
  if (action === 'reject') {
    await publishEvent('wallet.transactions', resultTxn.id, {
      user_id: resultTxn.tradingAccountId,
      transaction_type: 'CREDIT',
      amount: Number(resultTxn.amount),
    }).catch(err => {
      logger.error({ err, txnId: resultTxn.id }, 'Failed to publish refund wallet increment to Kafka');
    });
  }

  res.json({ success: true, data: resultTxn });
};

/**
 * getPendingWithdrawals — Finance team's FIFO withdrawal queue
 *
 * Returns all pending withdrawal requests ordered by createdAt ASC so the
 * oldest (most urgent) requests surface first. Supports cursor-based paging
 * via `page` + `limit` query params.
 */
export const getPendingWithdrawals = async (req: Request, res: Response): Promise<void> => {
  const page  = Math.max(1, Number(req.query['page'])  || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20));
  const skip  = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    prismaWrite.userTransaction.findMany({
      where:   { txnType: 'withdrawal', status: 'pending' },
      orderBy: { createdAt: 'asc' }, // FIFO — oldest first
      skip,
      take: limit,
      include: {
        // Full payment destination details — finance team needs bank/crypto info
        paymentMethod: true,
        // Account context — accountNumber visible in the admin queue
        user: {
          select: {
            accountNumber: true,
            currency:      true,
            accountName:   true,
          },
        },
      },
    }),
    prismaWrite.userTransaction.count({
      where: { txnType: 'withdrawal', status: 'pending' },
    }),
  ]);

  res.json({
    success:    true,
    data:       transactions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
};

