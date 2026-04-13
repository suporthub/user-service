import { v4 as uuidv4 } from 'uuid';
import { prismaWrite } from '../../lib/prisma';
import { logger } from '../../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Shape of the DEPOSIT_COMPLETED event emitted by payment-service
// Must match payment.types.ts :: DepositCompletedEvent
// ─────────────────────────────────────────────────────────────────────────────

interface DepositCompletedEvent {
  eventId:          string;   // UUID dedup key
  type:             'DEPOSIT_COMPLETED';
  paymentId:        string;   // GatewayPayment.id in payment_db
  merchantRefId:    string;
  gateway:          string;
  userId:           string;   // UserProfile.id
  userType:         string;
  tradingAccountId?: string;  // LiveUser.id — may be absent for legacy events
  creditAmountUsd:  number;
  currency:         'USD';
  fxRate?:          number;
  createdAt:        string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generates a human-readable transaction reference for client statements
// Format: TXN-YYYYMMDD-XXXXXXXX  e.g. TXN-20260413-A3F2C1D9
// ─────────────────────────────────────────────────────────────────────────────

function generateTxnRef(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
  return `TXN-${date}-${rand}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core handler — called by kafka.ts message router
//
// Responsibility:
//   1. Validate the event shape
//   2. Resolve which LiveUser account to credit
//      - Use tradingAccountId if present
//      - Auto-resolve if UserProfile owns exactly one live account (single-account users)
//      - Reject if ambiguous (multiple accounts, no tradingAccountId)
//   3. Idempotency guard — skip if GatewayPayment.linkedPaymentId already set
//   4. Atomically:
//      a) Read current walletBalance
//      b) Create UserTransaction with balanceBefore + balanceAfter snapshots
//      c) Increment LiveUser.walletBalance
//   5. Call payment-service internal API to link the UserTransaction back
//      (fire-and-forget — failure here does NOT roll back the credit)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleDepositCompleted(raw: Record<string, unknown>): Promise<void> {
  // ── 1. Type-guard / validate ───────────────────────────────────────────────
  const event = raw as Partial<DepositCompletedEvent>;

  if (
    !event.eventId ||
    !event.paymentId ||
    !event.userId ||
    typeof event.creditAmountUsd !== 'number' ||
    event.creditAmountUsd <= 0
  ) {
    logger.warn({ event }, '[payment.consumer] Malformed DEPOSIT_COMPLETED event — skipping');
    return;
  }

  const { eventId, paymentId, userId, userType, tradingAccountId, creditAmountUsd, gateway, merchantRefId } = event as DepositCompletedEvent;

  logger.info({ eventId, paymentId, userId, tradingAccountId, creditAmountUsd }, '[payment.consumer] Processing DEPOSIT_COMPLETED');

  // ── 2. Idempotency guard — check if we already processed this payment ──────
  // We use a DB-level unique check: if a UserTransaction with this linkedPaymentId
  // already exists, another consumer instance already processed it.
  const existing = await prismaWrite.userTransaction.findFirst({
    where: { linkedPaymentId: paymentId },
    select: { id: true },
  });

  if (existing) {
    logger.info({ eventId, paymentId }, '[payment.consumer] Already processed — skipping (idempotent)');
    return;
  }

  // ── 3. Resolve which LiveUser account to credit ───────────────────────────
  let liveUserId = tradingAccountId ?? null;

  if (!liveUserId) {
    // Auto-resolve: find live accounts owned by this UserProfile
    const accounts = await prismaWrite.liveUser.findMany({
      where:  { userProfileId: userId, isActive: true, deletedAt: null },
      select: { id: true, accountNumber: true },
    });

    if (accounts.length === 0) {
      logger.error({ eventId, userId }, '[payment.consumer] No active live accounts found for user — cannot credit');
      return;
    }

    if (accounts.length === 1) {
      // Single-account user: safe to auto-resolve
      liveUserId = accounts[0]!.id;
      logger.info({ eventId, userId, resolvedAccountId: liveUserId }, '[payment.consumer] Auto-resolved single trading account');
    } else {
      // Multiple accounts and no tradingAccountId — ambiguous, cannot credit
      logger.error(
        { eventId, userId, accountCount: accounts.length },
        '[payment.consumer] Multiple accounts found but no tradingAccountId in event — manual intervention required',
      );
      // TODO: Create an admin alert / pending manual credit record here
      return;
    }
  }

  // ── 4. Atomic credit: read balance → write txn → increment balance ─────────
  try {
    await prismaWrite.$transaction(async (tx) => {
      // Read current balance — done inside transaction to get a consistent snapshot
      const liveUser = await tx.liveUser.findUniqueOrThrow({
        where:  { id: liveUserId! },
        select: { id: true, walletBalance: true, userProfileId: true },
      });

      const balanceBefore = Number(liveUser.walletBalance);
      const balanceAfter  = Number((balanceBefore + creditAmountUsd).toFixed(6));

      // Create UserTransaction ledger entry
      await tx.userTransaction.create({
        data: {
          userId:           liveUserId!,     // LiveUser.id (the trading account being credited)
          userType:         userType || 'live',
          tradingAccountId: liveUserId!,
          txnType:          'deposit',
          direction:        'CREDIT',
          amount:           creditAmountUsd,
          currency:         'USD',
          balanceBefore,
          balanceAfter,
          txnRef:           generateTxnRef(),
          description:      `Deposit via ${gateway ?? 'gateway'}`,
          status:           'completed',
          approvedAt:       new Date(),
          linkedPaymentId:  paymentId,
          gateway:          gateway ?? null,
          ip:               null,            // Not available at webhook time; was captured at initiation
        },
      });

      // Increment LiveUser.walletBalance atomically
      await tx.liveUser.update({
        where: { id: liveUserId! },
        data:  { walletBalance: balanceAfter },
      });

      logger.info(
        { eventId, paymentId, liveUserId, balanceBefore, balanceAfter, creditAmountUsd },
        '[payment.consumer] ✅ Wallet credited successfully',
      );
    });
  } catch (err) {
    // Log full error — do NOT silently swallow credit failures
    logger.error(
      { err, eventId, paymentId, liveUserId, creditAmountUsd },
      '[payment.consumer] ❌ CRITICAL: Failed to credit wallet — requires manual intervention',
    );
    // Re-throw so Kafka consumer logs the error at the message level too
    throw err;
  }

  // ── 5. Fire-and-forget: notify payment-service to link the UserTransaction ──
  // This is best-effort — if it fails, the wallet is still correctly credited.
  // The payment-service admin panel can still query by paymentId to find the txn.
  try {
    const internalPaymentServiceUrl = process.env['PAYMENT_SERVICE_INTERNAL_URL'];
    if (internalPaymentServiceUrl) {
      // Fetch the txn we just created to get its ID
      const txn = await prismaWrite.userTransaction.findFirst({
        where:  { linkedPaymentId: paymentId },
        select: { id: true },
      });
      if (txn) {
        const fetch = (await import('node-fetch')).default;
        await fetch(`${internalPaymentServiceUrl}/internal/payments/${paymentId}/link-txn`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userTxnId: txn.id }),
        });
        logger.info({ paymentId, userTxnId: txn.id }, '[payment.consumer] Linked UserTransaction to GatewayPayment');
      }
    }
  } catch (linkErr) {
    // Non-fatal: wallet is already credited, just the cross-reference back-link failed
    logger.warn({ linkErr, paymentId }, '[payment.consumer] Failed to back-link UserTransaction to payment-service (non-fatal)');
  }
}
