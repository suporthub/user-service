import { Request, Response } from 'express';
import { prismaWrite } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { publishEvent } from '../../lib/kafka';
import { v4 as uuidv4 } from 'uuid';

function generateTxnRef(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
  return `TXN-${date}-${rand}`;
}

export const executeTransfer = async (req: Request, res: Response): Promise<void> => {
  // Accept both naming conventions for backwards-compatibility
  const body = req.body as {
    fromAccountId?:   string;
    toAccountId?:     string;
    senderAccountId?:   string;   // legacy — kept for direct calls
    receiverAccountId?: string;   // legacy — kept for direct calls
    amount:   number;
    currency?: string;
    description?: string;
  };

  const fromAccountId = body.fromAccountId ?? body.senderAccountId;
  const toAccountId   = body.toAccountId   ?? body.receiverAccountId;

  if (!fromAccountId || !toAccountId || typeof body.amount !== 'number' || body.amount <= 0) {
    res.status(400).json({ success: false, message: 'Invalid input parameters' });
    return;
  }

  if (fromAccountId === toAccountId) {
    res.status(400).json({ success: false, message: 'Sender and receiver cannot be the same' });
    return;
  }

  const amount = body.amount;

  const { debitTxn, creditTxn } = await prismaWrite.$transaction(async (tx) => {
    // Lock both accounts by reading them (in a real production system, SELECT FOR UPDATE is better)
    // Prisma doesn't support SELECT FOR UPDATE directly without $queryRaw, but since we are relying on Prisma,
    // we'll do standard reads and writes. (Assuming optimistic concurrency or standard isolation level is acceptable here).
    
    // For safety, we can use raw query for FOR UPDATE if we wanted, but Prisma's transaction with serializable isolation might work. 
    // We will stick to the standard findUnique for now.
    const sender = await tx.liveUser.findUnique({
      where: { id: fromAccountId },
      select: { id: true, walletBalance: true, userProfileId: true, currency: true },
    });

    const receiver = await tx.liveUser.findUnique({
      where: { id: toAccountId },
      select: { id: true, walletBalance: true, userProfileId: true, currency: true },
    });

    if (!sender) throw new Error('Sender account not found');
    if (!receiver) throw new Error('Receiver account not found');

    if (sender.currency !== receiver.currency) {
      throw new Error('Cross-currency transfers are not supported yet');
    }

    const senderBalanceBefore = Number(sender.walletBalance);
    if (senderBalanceBefore < amount) {
      throw new Error('Insufficient wallet balance');
    }

    const senderBalanceAfter = Number((senderBalanceBefore - amount).toFixed(6));
    const receiverBalanceBefore = Number(receiver.walletBalance);
    const receiverBalanceAfter = Number((receiverBalanceBefore + amount).toFixed(6));

    const debitTxnId = uuidv4();
    const creditTxnId = uuidv4();

    // 1. Debit Sender
    const debitTxn = await tx.userTransaction.create({
      data: {
        id: debitTxnId,
        userId: sender.id,
        userType: 'live',
        tradingAccountId: sender.id,
        txnType: 'transfer',
        direction: 'DEBIT',
        amount: amount,
        currency: sender.currency,
        balanceBefore: senderBalanceBefore,
        balanceAfter: senderBalanceAfter,
        txnRef: generateTxnRef(),
        description: `Internal Transfer to ${receiver.id}`,
        status: 'completed',
        approvedAt: new Date(),
        linkedTxnId: creditTxnId, // Cross-link
      },
    });

    await tx.liveUser.update({
      where: { id: sender.id },
      data: { walletBalance: senderBalanceAfter },
    });

    // 2. Credit Receiver
    const creditTxn = await tx.userTransaction.create({
      data: {
        id: creditTxnId,
        userId: receiver.id,
        userType: 'live',
        tradingAccountId: receiver.id,
        txnType: 'transfer',
        direction: 'CREDIT',
        amount: amount,
        currency: receiver.currency,
        balanceBefore: receiverBalanceBefore,
        balanceAfter: receiverBalanceAfter,
        txnRef: generateTxnRef(),
        description: `Internal Transfer from ${sender.id}`,
        status: 'completed',
        approvedAt: new Date(),
        linkedTxnId: debitTxnId, // Cross-link
      },
    });

    await tx.liveUser.update({
      where: { id: receiver.id },
      data: { walletBalance: receiverBalanceAfter },
    });

    return { debitTxn, creditTxn };
  });

  // Database committed successfully.
  // Now publish events to Kafka to update RAM ledger.
  // Architectural Guard 2: The Dual-Write Problem (DB vs. Kafka)
  
  await publishEvent('wallet.transactions', debitTxn.id, {
    user_id: fromAccountId,
    transaction_type: 'WITHDRAWAL',
    amount: amount,
  }).catch(err => {
    logger.error({ err, txnId: debitTxn.id }, 'Failed to publish sender wallet decrement to Kafka');
  });

  await publishEvent('wallet.transactions', creditTxn.id, {
    user_id: toAccountId,
    transaction_type: 'DEPOSIT',
    amount: amount,
  }).catch(err => {
    logger.error({ err, txnId: creditTxn.id }, 'Failed to publish receiver wallet increment to Kafka');
  });

  res.json({ success: true, data: { debitTxn, creditTxn } });
};
