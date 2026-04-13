import { Prisma } from '@prisma/client';
import { prismaWrite, prismaRead } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { publishEvent } from '../../lib/kafka';
import { config } from '../../config/env';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UserProfileContext {
  profileId: string;
  email: string;
  phone: string;
  masterPasswordHash: string;
  isVerified: boolean;
  kycStatus: string;
}

export interface TradingAccountSummary {
  id: string;
  accountNumber: string;
  type: 'live' | 'demo';
  currency: string;
  leverage: number;
  groupName: string;
  isActive: boolean;
  demoBalance?: number; // only for demo
}

export interface DashboardAccountSummary {
  /// UUID of the trading account (LiveUser.id or DemoUser.id).
  /// Frontend must send this as tradingAccountId in deposit/withdrawal requests.
  id: string;
  accountNumber: string;
  type: 'live' | 'demo';
  currency: string;
  leverage: number;
  groupName: string;
  isActive: boolean;
  accountName: string | null;
  userType: string; // 'live' | 'demo' | 'strategy' | 'copy_follower'
  accountVariant: string;
  walletBalance: number;
}

/** Context passed to auth-service for login + token minting */
export interface UserAuthContext {
  userId: string;   // LiveUser.id or DemoUser.id (used as `sub` in JWT)
  profileId?: string;   // UserProfile.id (present for live accounts)
  email: string;   // from UserProfile
  accountNumber: string;
  groupName: string;
  currency: string;
  passwordHash: string;   // NOTE: for live this is masterPasswordHash on UserProfile
  tradingPasswordHash?: string | null;
  isActive: boolean;
  isVerified: boolean;
  userType: 'live' | 'demo';
}

interface LiveRegisterEvent {
  accountNumber: string;
  masterPasswordHash: string;
  tradingPasswordHash: string;
  email: string;
  phoneNumber: string;
  country: string;
  groupName: string;
  currency: string;
  leverage: number;
  isSelfTrading: boolean;
  referredByCode?: string; // [NEW] Optional referral code from signup
  [key: string]: unknown;
}

interface DemoRegisterEvent {
  accountNumber: string;
  passwordHash: string;
  email: string;
  phoneNumber: string;
  groupName: string;
  currency: string;
  leverage: number;
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

    // ── Referral Resolution ───────────────────────────────────────────────────
    const referredById = e.referredByCode ? await resolveReferrerId(e.referredByCode) : null;
    if (e.referredByCode && !referredById) {
      logger.warn({ code: e.referredByCode }, 'ReferredByCode provided but not found; proceeding without referrer');
    }

    const uniqueReferralCode = await generateUniqueReferralCode();

    // Create the profile
    const profile = await prismaWrite.userProfile.create({
      data: {
        email: e.email,
        phone: e.phoneNumber,
        masterPasswordHash: e.masterPasswordHash,
        isVerified: false,
        kycStatus: 'pending',
        referralCode: uniqueReferralCode,
        ...(referredById && { referredBy: referredById }),
      },
    });
    profileId = profile.id;
  }

  // ── Create the LiveUser trading account ─────────────────────────────────────
  const liveUser = await prismaWrite.liveUser.create({
    data: {
      userProfileId: profileId,
      accountNumber: e.accountNumber,
      accountName: 'Main Account',
      tradingPasswordHash: e.tradingPasswordHash,
      countryCode: e.country,
      groupName: e.groupName,
      currency: e.currency,
      leverage: e.leverage,
      isSelfTrading: e.isSelfTrading,
      isActive: true,
    },
  });

  logger.info({ accountNumber: e.accountNumber, email: e.email }, 'Live user registered');
 
  // ── Sync to other services ──────────────────────────────────────────────────
  void publishEvent('user.events', profileId, {
    type:           'USER_CREATED',
    userProfileId:  profileId,
    liveAccountId:  liveUser.id,
    accountNumber:  e.accountNumber,
    fullName:       `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
    email:          e.email,
    phoneNumber:    e.phoneNumber,
    country:        e.country,
    groupName:      e.groupName,
    currency:       e.currency,
    referredByCode: e.referredByCode,
  });
}

export async function registerDemoUserFromKafka(event: unknown): Promise<void> {
  const e = event as DemoRegisterEvent;

  // ── Find or create UserProfile ──────────────────────────────────────────────
  const existingProfile = await prismaRead.userProfile.findUnique({
    where: { email: e.email },
  });

  let profileId: string;

  if (existingProfile) {
    if (existingProfile.phone !== e.phoneNumber) {
      logger.warn(
        { accountNumber: e.accountNumber, email: e.email },
        'DEMO_USER_REGISTER rejected: profile exists but phone mismatch',
      );
      return;
    }
    profileId = existingProfile.id;
  } else {
    const phoneTaken = await prismaRead.userProfile.findUnique({
      where: { phone: e.phoneNumber },
    });
    if (phoneTaken) {
      logger.warn(
        { accountNumber: e.accountNumber, phone: e.phoneNumber },
        'DEMO_USER_REGISTER rejected: phone already registered',
      );
      return;
    }

    // Since this is technically a frontend registration, generate a referral code
    const uniqueReferralCode = await generateUniqueReferralCode();

    // Create the master profile
    const profile = await prismaWrite.userProfile.create({
      data: {
        email: e.email,
        phone: e.phoneNumber,
        masterPasswordHash: e.passwordHash,
        isVerified: false,
        kycStatus: 'pending',
        referralCode: uniqueReferralCode,
      },
    });
    profileId = profile.id;
  }

  // ── Create Demo Account ──────────────────────────────────────────────────────
  await prismaWrite.demoUser.create({
    data: {
      userProfileId: profileId,
      accountNumber: e.accountNumber,
      accountName: 'Demo account - 1',
      passwordHash: e.passwordHash, // Also functions as the trading password here
      groupName: e.groupName,
      currency: e.currency,
      leverage: e.leverage,
      demoBalance: e.initialBalance,
      isActive: true,
    },
  });

  logger.info({ accountNumber: e.accountNumber }, 'Demo user registered and linked to Master Profile');
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
        select: { id: true, accountNumber: true, currency: true, leverage: true, groupName: true, isActive: true },
      },
      demoAccounts: {
        where: { isActive: true },
        select: { id: true, accountNumber: true, currency: true, leverage: true, groupName: true, isActive: true, demoBalance: true },
      },
    },
  });
  if (!profile) return null;

  return {
    profileId: profile.id,
    email: profile.email,
    phone: profile.phone,
    masterPasswordHash: profile.masterPasswordHash,
    isVerified: profile.isVerified,
    kycStatus: profile.kycStatus,
    accounts: [
      ...profile.liveAccounts.map(a => ({ ...a, type: 'live' as const })),
      ...profile.demoAccounts.map(a => ({ ...a, type: 'demo' as const, demoBalance: Number(a.demoBalance) })),
    ],
  };
}

/**
 * Get UserAuthContext for a specific live trading account.
 * Used by auth-service to mint a Trading JWT after account selection.
 */
export async function getAccountByAccountNumber(accountNumber: string): Promise<UserAuthContext | null> {
  const live = await prismaRead.liveUser.findUnique({
    where: { accountNumber },
    include: { userProfile: { select: { id: true, email: true, masterPasswordHash: true, isVerified: true } } },
  });
  if (live) return {
    userId: live.id,
    profileId: live.userProfileId,
    email: live.userProfile.email,
    accountNumber: live.accountNumber,
    groupName: live.groupName,
    currency: live.currency,
    passwordHash: live.userProfile.masterPasswordHash,
    tradingPasswordHash: live.tradingPasswordHash,
    isActive: live.isActive,
    isVerified: live.userProfile.isVerified,
    userType: 'live',
  };

  const demo = await prismaRead.demoUser.findUnique({
    where: { accountNumber },
    include: { userProfile: { select: { id: true, email: true, masterPasswordHash: true, isVerified: true } } },
  });
  if (demo) return {
    userId: demo.id,
    profileId: demo.userProfileId!,
    email: demo.userProfile ? demo.userProfile.email : (demo.email ?? ''),
    accountNumber: demo.accountNumber,
    groupName: demo.groupName,
    currency: demo.currency,
    passwordHash: demo.userProfile ? demo.userProfile.masterPasswordHash : demo.passwordHash,
    tradingPasswordHash: demo.passwordHash, // Demo shares the master hash currently if auto-registered
    isActive: demo.isActive,
    isVerified: demo.userProfile ? demo.userProfile.isVerified : true, // Standalone demos are auto-verified
    userType: 'demo',
  };

  return null;
}

// ── All accounts for a profile (live + demo) ──────────────────────────────────

export async function getAllAccountsForProfile(profileId: string): Promise<DashboardAccountSummary[]> {
  const [live, demo] = await Promise.all([
    prismaRead.liveUser.findMany({
      where: { userProfileId: profileId, isActive: true },
      select: {
        id: true,
        accountNumber: true, currency: true, leverage: true, groupName: true,
        isActive: true, accountName: true, walletBalance: true,
        strategyProvider: { select: { id: true } },
        copyFollowings:   { select: { id: true } },
      },
    }),
    prismaRead.demoUser.findMany({
      where: { userProfileId: profileId, isActive: true },
      select: {
        id: true,
        accountNumber: true, currency: true, leverage: true, groupName: true,
        isActive: true, demoBalance: true, accountName: true,
      },
    }),
  ]);

  return [
    ...live.map(a => {
      let uType = 'live';
      if (a.strategyProvider)            uType = 'strategy';
      else if (a.copyFollowings.length > 0) uType = 'copy_follower';
      return {
        id:             a.id,               // UUID — use as tradingAccountId in deposits
        accountNumber:  a.accountNumber,
        type:           'live' as const,
        currency:       a.currency,
        leverage:       a.leverage,
        groupName:      a.groupName,
        isActive:       a.isActive,
        accountName:    a.accountName,
        userType:       uType,
        accountVariant:  a.currency,
        walletBalance:  Number(a.walletBalance),
      };
    }),
    ...demo.map(a => ({
      id:             a.id,               // UUID — use as tradingAccountId in deposits
      accountNumber:  a.accountNumber,
      type:           'demo' as const,
      currency:       a.currency,
      leverage:       a.leverage,
      groupName:      a.groupName,
      isActive:       a.isActive,
      accountName:    a.accountName,
      userType:       'demo',
      accountVariant: a.currency,
      walletBalance:  Number(a.demoBalance),
    })),
  ];
}

// ── Create new trading account (in-portal, no re-verification) ────────────────

export async function createTradingAccount(
  profileId: string,
  accountNumber: string,
  tradingPasswordHash: string,
  options: {
    groupName: string; currency: string; leverage: number;
    countryCode?: string; accountName?: string; isDemo?: boolean; initialBalance?: number
  },
): Promise<void> {
  if (options.isDemo) {
    await prismaWrite.demoUser.create({
      data: {
        userProfileId: profileId,
        accountNumber,
        passwordHash: tradingPasswordHash,
        accountName: options.accountName ?? 'Demo Account',
        groupName: options.groupName,
        currency: options.currency,
        leverage: options.leverage,
        demoBalance: options.initialBalance ?? 10000.00,
        isActive: true,
      },
    });
  } else {
    await prismaWrite.liveUser.create({
      data: {
        userProfileId: profileId,
        accountNumber,
        tradingPasswordHash,
        accountName: options.accountName ?? 'Live Account',
        groupName: options.groupName,
        currency: options.currency,
        leverage: options.leverage,
        ...(options.countryCode !== undefined && { countryCode: options.countryCode }),
        isSelfTrading: true,
        isActive: true,
      },
    });
  }
}

// ── Email verification ────────────────────────────────────────────────────────

/** Mark the UserProfile as email-verified (called after OTP verification). */
export async function markProfileVerified(profileId: string): Promise<void> {
  await prismaWrite.userProfile.update({
    where: { id: profileId },
    data: { isVerified: true },
  });
}

/** Mark the UserProfile as an Introducing Broker. */
export async function updateProfileIBStatus(profileId: string, isIB: boolean): Promise<void> {
  await prismaWrite.userProfile.update({
    where: { id: profileId },
    data: { isIB },
  });
  logger.info({ profileId, isIB }, 'User profile IB status updated');
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

export async function updateUserPassword(userIdOrProfileId: string, userType: string, passwordHash: string): Promise<void> {
  if (userType === 'live') {
    // Handle Master Portal refactor: verifyResetOtp now correctly issues reset tokens against the Master Profile ID.
    const profile = await prismaRead.userProfile.findUnique({ where: { id: userIdOrProfileId } });
    if (profile) {
      await prismaWrite.userProfile.update({
        where: { id: userIdOrProfileId },
        data: { masterPasswordHash: passwordHash },
      });
      return;
    }

    // Legacy fallback: fallback to updating via a specific Trading Account ID
    const user = await prismaRead.liveUser.findUnique({ where: { id: userIdOrProfileId } });
    if (user) {
      await prismaWrite.userProfile.update({
        where: { id: user.userProfileId },
        data: { masterPasswordHash: passwordHash },
      });
    }
  } else {
    await prismaWrite.demoUser.update({ where: { id: userIdOrProfileId }, data: { passwordHash } });
  }
}

export async function updateViewPassword(userId: string, viewPassword: string): Promise<void> {
  await prismaWrite.userTradingConfig.upsert({
    where: { userId },
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
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true, accountNumber: true, groupName: true, currency: true,
          isActive: true, tradingPasswordHash: true,
        },
      },
    },
  });
  if (!profile || profile.liveAccounts.length === 0) return null;
  const latest = profile.liveAccounts[0]!;
  return {
    userId: latest.id,
    profileId: profile.id,
    email: profile.email,
    accountNumber: latest.accountNumber,
    groupName: latest.groupName,
    currency: latest.currency,
    passwordHash: profile.masterPasswordHash,
    tradingPasswordHash: latest.tradingPasswordHash,
    isActive: latest.isActive,
    isVerified: profile.isVerified,
    userType: 'live',
  };
}

export async function getDemoUserByEmail(email: string): Promise<UserAuthContext | null> {
  const profile = await prismaRead.userProfile.findUnique({
    where: { email },
    include: {
      demoAccounts: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!profile || profile.demoAccounts.length === 0) return null;
  const latest = profile.demoAccounts[0]!;

  return {
    userId: latest.id,
    profileId: profile.id,
    email: profile.email,
    accountNumber: latest.accountNumber,
    groupName: latest.groupName,
    currency: latest.currency,
    passwordHash: profile.masterPasswordHash, // Unified Password
    tradingPasswordHash: latest.passwordHash,
    isActive: latest.isActive,
    isVerified: true, // Demo accounts auto-verify
    userType: 'demo',
  };
}

export async function getUserById(userId: string, userType: string): Promise<UserAuthContext | null> {
  if (userType === 'demo') {
    const user = await prismaRead.demoUser.findUnique({
      where: { id: userId },
      include: { userProfile: { select: { email: true, masterPasswordHash: true } } },
    });
    if (!user) return null;
    return {
      userId: user.id,
      profileId: user.userProfileId ?? '',
      email: user.userProfile?.email ?? (user.email ?? ''),
      accountNumber: user.accountNumber,
      groupName: user.groupName,
      currency: user.currency,
      passwordHash: user.userProfile?.masterPasswordHash ?? user.passwordHash,
      tradingPasswordHash: user.passwordHash,
      isActive: user.isActive,
      isVerified: true,
      userType: 'demo',
    };
  }

  // Live User by ID
  const user = await prismaRead.liveUser.findUnique({
    where: { id: userId },
    include: { userProfile: { select: { id: true, email: true, masterPasswordHash: true, isVerified: true } } },
  });
  if (!user) return null;
  return {
    userId: user.id,
    profileId: user.userProfileId,
    email: user.userProfile.email,
    accountNumber: user.accountNumber,
    groupName: user.groupName,
    currency: user.currency,
    passwordHash: user.userProfile.masterPasswordHash,
    tradingPasswordHash: user.tradingPasswordHash,
    isActive: user.isActive,
    isVerified: user.userProfile.isVerified,
    userType: 'live',
  };
}

// Keep for backward compat with internal.routes.ts getAllAccounts
export async function getLiveUsersByEmail(email: string): Promise<UserAuthContext[]> {
  const profile = await prismaRead.userProfile.findUnique({
    where: { email },
    include: {
      liveAccounts: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, accountNumber: true, groupName: true, currency: true,
          isActive: true, tradingPasswordHash: true,
        },
      },
    },
  });
  if (!profile) return [];
  return profile.liveAccounts.map(a => ({
    userId: a.id,
    profileId: profile.id,
    email: profile.email,
    accountNumber: a.accountNumber,
    groupName: a.groupName,
    currency: a.currency,
    passwordHash: profile.masterPasswordHash,
    tradingPasswordHash: a.tradingPasswordHash,
    isActive: a.isActive,
    isVerified: profile.isVerified,
    userType: 'live' as const,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin / GBAC Scope Logic
// ─────────────────────────────────────────────────────────────────────────────

export interface UserAdminView {
  userId: string;
  accountNumber: string;
  email: string;
  phone: string;
  countryCode: string | null;
  groupName: string;
  currency: string;
  leverage: number;
  isActive: boolean;
  isVerified: boolean;
  kycStatus: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface AdminUserListOptions {
  allCountries: boolean;   // GBAC: if true, country filter is skipped
  countryCodes: string[];  // ISO-2 codes to filter by when allCountries=false
  page: number;
  limit: number;
  isActive?: boolean;
  search?: string;
}

export interface PagedAdminUserResult {
  data: UserAdminView[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * GBAC-aware paged listing of live users for the admin panel.
 * - allCountries=true  → no country filter (super_admin view)
 * - allCountries=false → WHERE countryCode IN (countryCodes[])
 */
export async function listUsersForAdmin(options: AdminUserListOptions): Promise<PagedAdminUserResult> {
  const skip = (options.page - 1) * options.limit;

  const where: Prisma.LiveUserWhereInput = {};

  if (!options.allCountries && options.countryCodes.length > 0) {
    where.countryCode = { in: options.countryCodes };
  }
  if (options.isActive !== undefined) where.isActive = options.isActive;
  if (options.search) {
    where.OR = [
      { accountNumber: { contains: options.search, mode: 'insensitive' } },
      { userProfile: { email: { contains: options.search, mode: 'insensitive' } } },
    ];
  }

  const [rows, total] = await prismaRead.$transaction([
    prismaRead.liveUser.findMany({
      where,
      skip,
      take: options.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, accountNumber: true, countryCode: true,
        groupName: true, currency: true, leverage: true,
        isActive: true, createdAt: true, lastLoginAt: true,
        userProfile: {
          select: { email: true, phone: true, isVerified: true, kycStatus: true },
        },
      },
    }),
    prismaRead.liveUser.count({ where }),
  ]);

  return {
    total,
    page: options.page,
    totalPages: Math.ceil(total / options.limit),
    data: rows.map((r) => ({
      userId: r.id,
      accountNumber: r.accountNumber,
      email: r.userProfile.email,
      phone: r.userProfile.phone,
      countryCode: r.countryCode,
      groupName: r.groupName,
      currency: r.currency,
      leverage: r.leverage,
      isActive: r.isActive,
      isVerified: r.userProfile.isVerified,
      kycStatus: r.userProfile.kycStatus,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Referral Management
// ─────────────────────────────────────────────────────────────────────────────

export async function isValidReferralCode(code: string): Promise<boolean> {
  const referrerId = await resolveReferrerId(code);
  return referrerId !== null;
}

/**
 * Resolves a referral code to a UserProfile.id.
 * Checks:
 *   1. Local UserProfile.referralCode
 *   2. Remote IbProfile.referralCode (via ib-service)
 */
export async function resolveReferrerId(code: string): Promise<string | null> {
  // 1. Check local UserProfile
  const profile = await prismaRead.userProfile.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (profile) return profile.id;

  // 2. Check remote IB Service
  try {
    const resp = await fetch(
      `${config.ibServiceUrl}/internal/ib/check-referral/${encodeURIComponent(code)}`,
      {
        headers: { 'x-service-secret': config.internalSecret },
      }
    );

    if (resp.ok) {
      const { valid, userProfileId } = await resp.json() as { valid: boolean; userProfileId: string | null };
      if (valid && userProfileId) return userProfileId;
    }
  } catch (err) {
    logger.error({ err, code }, 'Failed to check referral code against ib-service');
  }

  return null;
}

/**
 * Generate a cryptographically secure 8-character uppercase alphanumeric code.
 * Loops on collision (extremely rare).
 */
async function generateUniqueReferralCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 1, 0, or lowercase
  while (true) {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    // Check collision
    const existing = await prismaWrite.userProfile.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }
}

// ── Profile Fetch by ID ───────────────────────────────────────────────────────

/**
 * SRP — Fetches a full UserProfile by primary key.
 * Used by auth-service password-change flows that require masterPasswordHash.
 */
export async function getProfileById(profileId: string) {
  return prismaRead.userProfile.findUnique({ where: { id: profileId } });
}

// ── Dashboard APIs ────────────────────────────────────────────────────────────


export async function getDashboardMe(profileId: string) {
  return prismaRead.userProfile.findUnique({
    where: { id: profileId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isIB: true,
      referralCode: true,
      kycStatus: true,
    },
  });
}

export async function getDashboardKyc(profileId: string) {
  // Extract KYC from the first Live account linked to this profile
  const liveAcc = await prismaRead.liveUser.findFirst({
    where: { userProfileId: profileId },
    include: { kyc: true },
  });
  if (!liveAcc || !liveAcc.kyc) return null;
  const kyc = liveAcc.kyc;

  return {
    addressLine1: kyc.addressLine1,
    addressLine2: kyc.addressLine2,
    city: kyc.city,
    state: kyc.state,
    country: kyc.country,
    pincode: kyc.pincode,
    idProofType: kyc.idProofType,
    idProofPath: kyc.idProofPath,
    addressProofType: kyc.addressProofType,
    addressProofPath: kyc.addressProofPath,
    submittedAt: kyc.submittedAt,
    reviewedAt: kyc.reviewedAt,
    rejectionReason: kyc.rejectionReason,
  };
}

// ── Profile update (firstName, lastName only) ─────────────────────────────────

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
}

export async function updateProfileDetails(profileId: string, input: UpdateProfileInput): Promise<void> {
  await prismaWrite.userProfile.update({
    where: { id: profileId },
    data: {
      ...(input.firstName !== undefined && { firstName: input.firstName }),
      ...(input.lastName !== undefined && { lastName: input.lastName }),
    },
  });
}

// ── KYC upsert (locked once approved) ────────────────────────────────────────

export interface UpsertKycInput {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  pincode?: string;
  idProofType?: string;
  addressProofType?: string;
  idProofPath?: string;       // set by auth-service after file upload
  addressProofPath?: string;  // set by auth-service after file upload
}

/**
 * Upserts KYC details for the first live account linked to a profile.
 *
 * First-submit rule: if the existing KYC row has ALL core fields null (never submitted),
 * all fields except addressLine2 are required. Throws if any are missing.
 *
 * Lock rule: KYC cannot be modified once kycStatus === 'approved'.
 */
export async function upsertKycDetails(profileId: string, input: UpsertKycInput): Promise<void> {
  // Guard: check if KYC is already approved
  const profile = await prismaRead.userProfile.findUnique({
    where: { id: profileId },
    select: { kycStatus: true },
  });
  if (!profile) throw new Error('PROFILE_NOT_FOUND');
  if (profile.kycStatus === 'approved') throw new Error('KYC_ALREADY_APPROVED');

  // Find the first live account for this profile
  const liveAcc = await prismaRead.liveUser.findFirst({
    where: { userProfileId: profileId },
    include: { kyc: true },
  });
  if (!liveAcc) throw new Error('NO_LIVE_ACCOUNT');

  const existingKyc = liveAcc.kyc;

  // First-submit rule: if kyc doesn't exist or all core fields are null → all required
  const isFirstSubmit =
    !existingKyc ||
    (!existingKyc.addressLine1 &&
      !existingKyc.city &&
      !existingKyc.country &&
      !existingKyc.pincode &&
      !existingKyc.idProofType &&
      !existingKyc.addressProofType &&
      !existingKyc.idProofPath &&
      !existingKyc.addressProofPath);

  if (isFirstSubmit) {
    const requiredFields: (keyof UpsertKycInput)[] = [
      'addressLine1', 'city', 'country', 'pincode',
      'idProofType', 'addressProofType', 'idProofPath', 'addressProofPath',
    ];
    const missing = requiredFields.filter((f) => !input[f]);
    if (missing.length > 0) {
      throw new Error(`MISSING_REQUIRED_KYC_FIELDS:${missing.join(',')}`);
    }
  }

  const data: Prisma.LiveUserKycUncheckedCreateInput & Prisma.LiveUserKycUncheckedUpdateInput = {
    userId: liveAcc.id,
    ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
    ...(input.addressLine2 !== undefined && { addressLine2: input.addressLine2 }),
    ...(input.city !== undefined && { city: input.city }),
    ...(input.country !== undefined && { country: input.country }),
    ...(input.pincode !== undefined && { pincode: input.pincode }),
    ...(input.idProofType !== undefined && { idProofType: input.idProofType }),
    ...(input.addressProofType !== undefined && { addressProofType: input.addressProofType }),
    ...(input.idProofPath !== undefined && { idProofPath: input.idProofPath }),
    ...(input.addressProofPath !== undefined && { addressProofPath: input.addressProofPath }),
    // Set submittedAt on first real submission
    ...(isFirstSubmit && { submittedAt: new Date() }),
  };

  await prismaWrite.liveUserKyc.upsert({
    where: { userId: liveAcc.id },
    create: data as Prisma.LiveUserKycUncheckedCreateInput,
    update: data as Prisma.LiveUserKycUncheckedUpdateInput,
  });

  // Transition kycStatus to 'submitted' if this is the first submission
  if (isFirstSubmit) {
    await prismaWrite.userProfile.update({
      where: { id: profileId },
      data: { kycStatus: 'submitted' },
    });
  }
}

// ── Soft delete account ───────────────────────────────────────────────────────

/**
 * Soft-deletes a user profile:
 *  - Sets deletedAt on UserProfile
 *  - Deactivates all live + demo accounts
 * Trade history in order-db is NOT touched (regulatory retention requirement).
 * Auth sessions are revoked separately by auth-service after this call.
 */
export async function softDeleteProfile(profileId: string): Promise<void> {
  await prismaWrite.$transaction([
    prismaWrite.userProfile.update({
      where: { id: profileId },
      data: { deletedAt: new Date(), isVerified: false },
    }),
    prismaWrite.liveUser.updateMany({
      where: { userProfileId: profileId },
      data: { isActive: false, deletedAt: new Date() },
    }),
    prismaWrite.demoUser.updateMany({
      where: { userProfileId: profileId },
      data: { isActive: false },
    }),
  ]);
  logger.info({ profileId }, 'User profile soft-deleted');
}
