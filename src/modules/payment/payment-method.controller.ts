/**
 * payment-method.controller.ts
 *
 * Handles creation and retrieval of user payout destinations (banks, crypto).
 *
 * KEY ARCHITECTURE: Payment methods are linked to the MASTER PROFILE (UserProfile),
 * NOT to an individual trading account (LiveUser). This allows a user to reuse
 * the same bank/wallet across all their trading accounts.
 *
 * Key business rule — isDefault exclusivity:
 *   Only ONE payment method per user can be the default at any time.
 *   When a new method is created with isDefault: true, all other methods for
 *   that profile are atomically set to isDefault: false in the same transaction.
 */

import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prismaWrite, prismaRead } from '../../lib/prisma';


// ── Types ─────────────────────────────────────────────────────────────────────

interface CreatePaymentMethodBody {
  userId:        string;   // Master profile UUID (resolved from JWT by auth-service)
  type:          string;   // 'BANK' | 'CRYPTO' | 'E_WALLET'
  providerName:  string;   // e.g. 'Chase Bank' or 'Binance'
  accountName:   string;   // Account holder / wallet label
  accountNumber: string;   // IBAN, routing number, or crypto address
  routingNumber?: string;
  swiftCode?:    string;
  network?:      string;   // Crypto only: 'ERC20', 'TRC20', etc.
  isDefault?:    boolean;
}

// ── GET /internal/payment-methods/:userId ────────────────────────────────────

/**
 * List all active payment methods for a user profile.
 * Ordered by: default first, then most recently created.
 */
export async function listPaymentMethods(req: Request, res: Response): Promise<void> {
  const { userId } = req.params as { userId: string };

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  const methods = await prismaRead.userPaymentMethod.findMany({
    where:   { userId, isActive: true },
    orderBy: [
      { isDefault: 'desc' },    // Default method first
      { createdAt: 'desc' },    // Most recently added next
    ],
    select: {
      id:            true,
      type:          true,
      label:         true,
      details:       true,      // Contains accountNumber, network, etc.
      isDefault:     true,
      isVerified:    true,
      createdAt:     true,
    },
  });

  res.json({ success: true, data: methods });
}

// ── POST /internal/payment-methods ───────────────────────────────────────────

/**
 * Create a new payment method for a user.
 *
 * isDefault exclusivity is enforced atomically:
 *   If isDefault=true, all other methods for this user are set to false first
 *   in the same Prisma transaction, guaranteeing only one default at all times.
 */
export async function createPaymentMethod(req: Request, res: Response): Promise<void> {
  const {
    userId,
    type,
    providerName,
    accountName,
    accountNumber,
    routingNumber,
    swiftCode,
    network,
    isDefault = false,
  } = req.body as CreatePaymentMethodBody;

  if (!userId || !type || !providerName || !accountName || !accountNumber) {
    res.status(400).json({
      success: false,
      message: 'userId, type, providerName, accountName, and accountNumber are required',
    });
    return;
  }

  // Build the JSON details blob — stored in the `details` JSON field
  const details: Record<string, string> = { accountNumber, accountName };
  if (routingNumber) details['routingNumber'] = routingNumber;
  if (swiftCode)     details['swiftCode']     = swiftCode;
  if (network)       details['network']        = network;

  // ── Atomic transaction for isDefault exclusivity ──────────────────────────
  const newMethod = await prismaWrite.$transaction(async (tx: Prisma.TransactionClient) => {
    // Step 1: If this method should be the default, demote all existing defaults
    if (isDefault) {
      await tx.userPaymentMethod.updateMany({
        where: { userId, isDefault: true },
        data:  { isDefault: false },
      });
    }

    // Step 2: Create the new payment method
    return tx.userPaymentMethod.create({
      data: {
        userId,
        type,
        label:     providerName,   // label maps to providerName in our schema
        details,
        isDefault,
        isActive:  true,
        isVerified: false,          // Admin verifies bank details before first use
      },
      select: {
        id:         true,
        type:       true,
        label:      true,
        details:    true,
        isDefault:  true,
        isVerified: true,
        createdAt:  true,
      },
    });
  });

  res.status(201).json({ success: true, data: newMethod });
}
