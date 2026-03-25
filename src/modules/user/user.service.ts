import { prismaWrite, prismaRead } from '../../lib/prisma';
import { logger } from '../../lib/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UserProfileContext {
  profileId:          string;
  email:              string;
  phone:              string;
  masterPasswordHash: string;
  isVerified:         boolean;
  kycStatus:          string;
}

export interface TradingAccountSummary {
  accountNumber: string;
  type:          'live' | 'demo';
  currency:      string;
  leverage:      number;
  groupName:     string;
  isActive:      boolean;
  demoBalance?:  number; // only for demo
}

/** Context passed to auth-service for login + token minting */
export interface UserAuthContext {
  userId:        string;   // LiveUser.id or DemoUser.id (used as `sub` in JWT)
  profileId?:    string;   // UserProfile.id (present for live accounts)
  email:         string;   // from UserProfile
  accountNumber: string;
  groupName:     string;
  currency:      string;
  passwordHash:  string;   // NOTE: for live this is masterPasswordHash on UserProfile
  tradingPasswordHash?: string | null;
  isActive:      boolean;
  isVerified:    boolean;
  userType:      'live' | 'demo';
}

interface LiveRegisterEvent {
  accountNumber:      string;
  masterPasswordHash: string;
  tradingPasswordHash: string;
  email:              string;
  phoneNumber:        string;
  country:            string;
  groupName:          string;
  currency:           string;
  leverage:           number;
  isSelfTrading:      boolean;
  [key: string]: unknown;
}

interface DemoRegisterEvent {
  accountNumber:  string;
  passwordHash:   string;
  email?:         string;
  groupName:      string;
  currency:       string;
  leverage:       number;
  initialBalance: number;
  [key: string]: unknown;
}

// ── Register from Kafka ───────────────────────────────────────────────────────

/**
 * Called by the Kafka consumer when LIVE_USER_REGISTER is received.
 *
 * Business rules:
 *   1. One UserProfile per (email, phone) pair.
 *   2. Same phone with a DIFFERENT email → rejected.
 *   3. Same email + same phone → a new LiveUser trading account is added.
 */
export async function registerLiveUserFromKafka(event: unknown): Promise<void> {
  const e = event as LiveRegisterEvent;

  // ── Find or create UserProfile ──────────────────────────────────────────────
  // If a profile already exists with this email, reuse it (new trading account).
  // If phone is used by a DIFFERENT email, reject.
  const existingProfile = await prismaRead.userProfile.findUnique({
    where: { email: e.email },
  });

  let profileId: string;

  if (existingProfile) {
    // Profile exists — check phone consistency
    if (existingProfile.phone !== e.phoneNumber) {
      logger.warn(
        { accountNumber: e.accountNumber, email: e.email },
        'LIVE_USER_REGISTER rejected: profile exists but phone mismatch',
      );
      return;
    }
    profileId = existingProfile.id;
  } else {
    // New profile — check phone uniqueness globally
    const phoneTaken = await prismaRead.userProfile.findUnique({
      where: { phone: e.phoneNumber },
    });
    if (phoneTaken) {
      logger.warn(
        { accountNumber: e.accountNumber, phone: e.phoneNumber },
        'LIVE_USER_REGISTER rejected: phone already registered to a different profile',
      );
      return;
    }
    // Create the profile
    const profile = await prismaWrite.userProfile.create({
      data: {
        email:              e.email,
        phone:              e.phoneNumber,
        masterPasswordHash: e.masterPasswordHash,
        isVerified:         false,
        kycStatus:          'pending',
      },
    });
    profileId = profile.id;
  }

  // ── Create the LiveUser trading account ─────────────────────────────────────
  await prismaWrite.liveUser.create({
    data: {
      userProfileId:       profileId,
      accountNumber:       e.accountNumber,
      tradingPasswordHash: e.tradingPasswordHash,
      countryCode:         e.country,
      groupName:           e.groupName,
      currency:            e.currency,
      leverage:            e.leverage,
      isSelfTrading:       e.isSelfTrading,
      isActive:            true,
    },
  });

  logger.info({ accountNumber: e.accountNumber, email: e.email }, 'Live user registered');
}

export async function registerDemoUserFromKafka(event: unknown): Promise<void> {
  const e = event as DemoRegisterEvent;

  await prismaWrite.demoUser.create({
    data: {
      accountNumber: e.accountNumber,
      ...(e.email !== undefined && { email: e.email }),
      passwordHash:  e.passwordHash,
      groupName:     e.groupName,
      currency:      e.currency,
      leverage:      e.leverage,
      demoBalance:   e.initialBalance,
      isActive:      true,
    },
  });

  logger.info({ accountNumber: e.accountNumber }, 'Demo user registered');
}

// ── Profile lookups (used by auth-service internal API) ───────────────────────

/**
 * Fetch the UserProfile by email.
 * Returns profile context including all linked live trading accounts.
 * Used by auth-service for login.
 */
export async function getUserProfileByEmail(email: string): Promise<
  (UserProfileContext & { accounts: TradingAccountSummary[] }) | null
> {
  const profile = await prismaRead.userProfile.findUnique({
    where: { email },
    include: {
      liveAccounts: {
        where: { isActive: true },
        select: { accountNumber: true, currency: true, leverage: true, groupName: true, isActive: true },
      },
    },
  });
  if (!profile) return null;

  return {
    profileId:          profile.id,
    email:              profile.email,
    phone:              profile.phone,
    masterPasswordHash: profile.masterPasswordHash,
    isVerified:         profile.isVerified,
    kycStatus:          profile.kycStatus,
    accounts:           profile.liveAccounts.map(a => ({ ...a, type: 'live' as const })),
  };
}

/**
 * Get UserAuthContext for a specific live trading account.
 * Used by auth-service to mint a Trading JWT after account selection.
 */
export async function getLiveUserByAccountNumber(accountNumber: string): Promise<UserAuthContext | null> {
  const user = await prismaRead.liveUser.findUnique({
    where: { accountNumber },
    include: { userProfile: { select: { id: true, email: true, masterPasswordHash: true, isVerified: true } } },
  });
  if (!user) return null;
  return {
    userId:              user.id,
    profileId:           user.userProfileId,
    email:               user.userProfile.email,
    accountNumber:       user.accountNumber,
    groupName:           user.groupName,
    currency:            user.currency,
    passwordHash:        user.userProfile.masterPasswordHash,
    tradingPasswordHash: user.tradingPasswordHash,
    isActive:            user.isActive,
    isVerified:          user.userProfile.isVerified,
    userType:            'live',
  };
}

// ── All accounts for a profile (live + demo) ──────────────────────────────────

export async function getAllAccountsForProfile(profileId: string): Promise<TradingAccountSummary[]> {
  const [live, demo] = await Promise.all([
    prismaRead.liveUser.findMany({
      where: { userProfileId: profileId, isActive: true },
      select: { accountNumber: true, currency: true, leverage: true, groupName: true, isActive: true },
    }),
    prismaRead.demoUser.findMany({
      where: { userProfileId: profileId, isActive: true },
      select: { accountNumber: true, currency: true, leverage: true, groupName: true, isActive: true, demoBalance: true },
    }),
  ]);

  return [
    ...live.map(a => ({ ...a, type: 'live' as const })),
    ...demo.map(a => ({
      ...a,
      type:        'demo' as const,
      demoBalance: Number(a.demoBalance),
    })),
  ];
}

// ── Create new trading account (in-portal, no re-verification) ────────────────

export async function createTradingAccount(
  profileId:           string,
  accountNumber:       string,
  tradingPasswordHash: string,
  options: { groupName: string; currency: string; leverage: number; countryCode?: string },
): Promise<void> {
  await prismaWrite.liveUser.create({
    data: {
      userProfileId:       profileId,
      accountNumber,
      tradingPasswordHash,
      groupName:           options.groupName,
      currency:            options.currency,
      leverage:            options.leverage,
      ...(options.countryCode !== undefined && { countryCode: options.countryCode }),
      isSelfTrading:       true,
      isActive:            true,
    },
  });
}

// ── Email verification ────────────────────────────────────────────────────────

/** Mark the UserProfile as email-verified (called after OTP verification). */
export async function markProfileVerified(profileId: string): Promise<void> {
  await prismaWrite.userProfile.update({
    where: { id: profileId },
    data:  { isVerified: true },
  });
}

/** Mark a specific live account as verified (legacy — now delegates to profile). */
export async function markEmailVerified(userId: string): Promise<void> {
  // Find live user, then mark profile verified
  const user = await prismaRead.liveUser.findUnique({ where: { id: userId } });
  if (user) await markProfileVerified(user.userProfileId);
}

// ── Phone availability ────────────────────────────────────────────────────────

/**
 * Phone uniqueness rule:
 *   - A phone number is ONLY blocked if it's already used by a DIFFERENT email.
 *   - The same user (same email) can register multiple accounts with same phone.
 */
export async function isPhoneAvailable(phone: string, ownerEmail?: string): Promise<boolean> {
  const profile = await prismaRead.userProfile.findUnique({ where: { phone } });
  if (!profile) return true;
  // Phone is taken by THIS email (same person) → allowed
  if (ownerEmail && profile.email === ownerEmail) return true;
  // Phone is taken by a DIFFERENT email → blocked
  return false;
}

// ── Password updates ──────────────────────────────────────────────────────────

export async function updateUserPassword(userId: string, userType: string, passwordHash: string): Promise<void> {
  if (userType === 'live') {
    // Update the master password on the UserProfile
    const user = await prismaRead.liveUser.findUnique({ where: { id: userId } });
    if (user) {
      await prismaWrite.userProfile.update({
        where: { id: user.userProfileId },
        data:  { masterPasswordHash: passwordHash },
      });
    }
  } else {
    await prismaWrite.demoUser.update({ where: { id: userId }, data: { passwordHash } });
  }
}

export async function updateViewPassword(userId: string, viewPassword: string): Promise<void> {
  await prismaWrite.userTradingConfig.upsert({
    where:  { userId },
    create: { userId, viewPasswordHash: viewPassword },
    update: { viewPasswordHash: viewPassword },
  });
}

// ── Last login ────────────────────────────────────────────────────────────────

export async function touchLastLogin(userId: string, userType: string): Promise<void> {
  if (userType === 'live') {
    await prismaWrite.liveUser.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  } else {
    await prismaWrite.demoUser.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }
}

// ── Legacy helpers (used by existing routes) ──────────────────────────────────

// Keep for backward compat — used by login flow before profile migration
export async function getLiveUserByEmail(email: string): Promise<UserAuthContext | null> {
  const profile = await prismaRead.userProfile.findUnique({
    where: { email },
    include: {
      liveAccounts: {
        where:   { isActive: true },
        orderBy: { createdAt: 'desc' },
        take:    1,
        select:  {
          id: true, accountNumber: true, groupName: true, currency: true,
          isActive: true, tradingPasswordHash: true,
        },
      },
    },
  });
  if (!profile || profile.liveAccounts.length === 0) return null;
  const latest = profile.liveAccounts[0]!;
  return {
    userId:              latest.id,
    profileId:           profile.id,
    email:               profile.email,
    accountNumber:       latest.accountNumber,
    groupName:           latest.groupName,
    currency:            latest.currency,
    passwordHash:        profile.masterPasswordHash,
    tradingPasswordHash: latest.tradingPasswordHash,
    isActive:            latest.isActive,
    isVerified:          profile.isVerified,
    userType:            'live',
  };
}

export async function getDemoUserByEmail(email: string): Promise<UserAuthContext | null> {
  const user = await prismaRead.demoUser.findFirst({
    where:   { email, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, accountNumber: true, groupName: true,
      currency: true, passwordHash: true, isActive: true,
    },
  });
  if (!user) return null;
  return { ...user, userId: user.id, email: user.email ?? '', userType: 'demo', isVerified: true, passwordHash: user.passwordHash };
}

export async function getUserById(userId: string, userType: string): Promise<UserAuthContext | null> {
  if (userType === 'demo') {
    const user = await prismaRead.demoUser.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, accountNumber: true, groupName: true,
        currency: true, passwordHash: true, isActive: true,
      },
    });
    if (!user) return null;
    return { ...user, userId: user.id, email: user.email ?? '', userType: 'demo', isVerified: true, passwordHash: user.passwordHash };
  }
  return getLiveUserByAccountNumber(userId) ?? getLiveUserByAccountNumber(userId);
}

// Keep for backward compat with internal.routes.ts getAllAccounts
export async function getLiveUsersByEmail(email: string): Promise<UserAuthContext[]> {
  const profile = await prismaRead.userProfile.findUnique({
    where: { email },
    include: {
      liveAccounts: {
        where:   { isActive: true },
        orderBy: { createdAt: 'desc' },
        select:  {
          id: true, accountNumber: true, groupName: true, currency: true,
          isActive: true, tradingPasswordHash: true,
        },
      },
    },
  });
  if (!profile) return [];
  return profile.liveAccounts.map(a => ({
    userId:              a.id,
    profileId:           profile.id,
    email:               profile.email,
}
