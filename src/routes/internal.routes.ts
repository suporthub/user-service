import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { prismaRead } from '../lib/prisma';
import {
  getUserProfileByEmail,
  getAccountByAccountNumber,
  getLiveUsersByEmail,
  getAllAccountsForProfile,
  createTradingAccount,
  getDemoUserByEmail,
  getUserById,
  isPhoneAvailable,
  updateUserPassword,
  updateViewPassword,
  markProfileVerified,
  markEmailVerified,
  touchLastLogin,
  listUsersForAdmin,
  isValidReferralCode,
  getDashboardMe,
  getDashboardKyc,
} from '../modules/user/user.service';

const router = Router();

// ── Internal auth middleware — x-service-secret ───────────────────────────────
router.use((req: Request, res: Response, next: () => void) => {
  if (req.headers['x-service-secret'] !== config.internalSecret) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return;
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile endpoints (Master Portal architecture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /internal/users/by-email
 * Returns UserProfile + live accounts list for login.
 * Used by auth-service to verify master password and enumerate accounts.
 */
router.post('/users/by-email', async (req: Request, res: Response) => {
  const { email, userType } = req.body as { email: string; userType?: string };
  if (!email) { res.status(400).json({ success: false, message: 'email is required' }); return; }

  if (userType === 'demo') {
    const user = await getDemoUserByEmail(email);
    if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
    res.json(user);
    return;
  }

  // Live: return UserProfile with accounts list
  const profile = await getUserProfileByEmail(email);
  if (!profile) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json(profile);
});

/**
 * GET /internal/profiles/:id
 * Fetches a Master Profile by raw ID for auth-service validation.
 */
router.get('/profiles/:id', async (req: Request, res: Response) => {
  const profile = await prismaRead.userProfile.findUnique({ where: { id: req.params.id } });
  if (!profile) { res.status(404).json({ success: false, message: 'Profile not found' }); return; }
  res.json(profile);
});

/**
 * GET /internal/profiles/me/:id
 * Fetches Dashboard identity metrics.
 */
router.get('/profiles/me/:id', async (req: Request, res: Response) => {
  const data = await getDashboardMe(req.params.id!);
  res.json(data);
});

/**
 * GET /internal/profiles/kyc/:id
 * Fetches Dashboard KYC metrics.
 */
router.get('/profiles/kyc/:id', async (req: Request, res: Response) => {
  const data = await getDashboardKyc(req.params.id!);
  // allow null returns if no KYC exists
  res.json(data || {});
});

/**
 * POST /internal/users/by-email/all
 * Returns ALL live accounts for an email (multi-account list).
 */
router.post('/users/by-email/all', async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };
  if (!email) { res.status(400).json({ success: false, message: 'email is required' }); return; }
  const users = await getLiveUsersByEmail(email);
  res.json({ success: true, data: users });
});

/**
 * GET /internal/users/by-account/:accountNumber
 * Fetch UserAuthContext for a specific trading account.
 * Used by auth-service to mint a Trading JWT after account selection.
 */
router.get('/users/by-account/:accountNumber', async (req: Request, res: Response) => {
  const user = await getAccountByAccountNumber(req.params.accountNumber!);
  if (!user) { res.status(404).json({ success: false, message: 'Account not found' }); return; }
  res.json(user);
});

/**
 * GET /internal/users/:id
 * Fetch user auth context by user ID.
 */
router.get('/users/:id', async (req: Request, res: Response) => {
  const { userType } = req.query as { userType?: string };
  const user = await getUserById(req.params.id!, userType ?? 'live');
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json(user);
});

/**
 * GET /internal/accounts/:profileId
 * Returns all live + demo accounts linked to a UserProfile.
 * Used by auth-service GET /api/live/accounts.
 */
router.get('/accounts/:profileId', async (req: Request, res: Response) => {
  const accounts = await getAllAccountsForProfile(req.params.profileId!);
  res.json({ success: true, data: accounts });
});

/**
 * POST /internal/accounts
 * Create a new trading account under an existing UserProfile.
 * Called by auth-service when a logged-in user opens a new account.
 * No email verification needed — profile is already verified.
 */
router.post('/accounts', async (req: Request, res: Response) => {
  const { 
    profileId, accountNumber, tradingPasswordHash, 
    groupName, currency, leverage, countryCode,
    accountName, isDemo, initialBalance 
  } = req.body as {
    profileId: string; accountNumber: string; tradingPasswordHash: string;
    groupName: string; currency: string; leverage: number; countryCode?: string;
    accountName?: string; isDemo?: boolean; initialBalance?: number;
  };
  
  if (!profileId || !accountNumber) {
    res.status(400).json({ success: false, message: 'profileId and accountNumber are required' });
    return;
  }
  
  await createTradingAccount(profileId, accountNumber, tradingPasswordHash, {
    groupName, currency, leverage,
    ...(accountName !== undefined && { accountName }),
    ...(isDemo !== undefined && { isDemo }),
    ...(initialBalance !== undefined && { initialBalance }),
    ...(countryCode !== undefined && { countryCode }),
  });
  
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check-phone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/users/check-phone/:phone?ownerEmail=<email>
 * Returns { available: true } if the phone is not taken by a different email.
 */
router.get('/users/check-phone/:phone', async (req: Request, res: Response) => {
  const { ownerEmail } = req.query as { ownerEmail?: string };
  const available = await isPhoneAvailable(decodeURIComponent(req.params.phone!), ownerEmail);
  res.json({ success: true, available });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check Referral Code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/users/check-referral/:code
 * Returns { valid: true } if the referralCode corresponds to an existing Profile.
 */
router.get('/users/check-referral/:code', async (req: Request, res: Response) => {
  const code = req.params.code;
  if (!code) { res.status(400).json({ success: false, message: 'Code is required' }); return; }
  const valid = await isValidReferralCode(code);
  res.json({ success: true, valid });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password + view-password updates
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/users/:id/password', async (req: Request, res: Response) => {
  const { passwordHash, userType } = req.body as { passwordHash: string; userType: string };
  if (!passwordHash) { res.status(400).json({ success: false, message: 'passwordHash is required' }); return; }
  await updateUserPassword(req.params.id!, userType ?? 'live', passwordHash);
  res.json({ success: true });
});

router.patch('/users/:id/view-password', async (req: Request, res: Response) => {
  const { viewPassword } = req.body as { viewPassword: string };
  if (!viewPassword) { res.status(400).json({ success: false, message: 'viewPassword is required' }); return; }
  await updateViewPassword(req.params.id!, viewPassword);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH /internal/profiles/:profileId/verify-email
 * Marks the UserProfile as email-verified.
 * Called after OTP verification — verification is per-profile, not per account.
 */
router.patch('/profiles/:profileId/verify-email', async (req: Request, res: Response) => {
  await markProfileVerified(req.params.profileId!);
  res.json({ success: true });
});

/**
 * PATCH /internal/users/:id/verify-email
 * Legacy route — resolves the user's profile and marks it verified.
 */
router.patch('/users/:id/verify-email', async (req: Request, res: Response) => {
  await markEmailVerified(req.params.id!);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Last login
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/users/:id/touch-login', async (req: Request, res: Response) => {
  const { userType } = req.body as { userType?: string };
  await touchLastLogin(req.params.id!, userType ?? 'live');
  res.json({ success: true });
});

/**
 * GET /internal/admin/users
 * GBAC-scoped paged user listing for the admin panel.
 *
 * The order-gateway (or admin-service) reads allCountries + countryCodes from
 * the admin JWT and forwards them as JSON in x-admin-scope header:
 *   { "allCountries": false, "countryCodes": ["IN", "AE"] }
 *
 * This service NEVER parses the JWT — it trusts the scope passed by the gateway.
 */
router.get('/admin/users', async (req: Request, res: Response) => {
  const scopeHeader = req.headers['x-admin-scope'] as string | undefined;
  let allCountries = true;
  let countryCodes: string[] = [];

  if (scopeHeader) {
    try {
      const scope = JSON.parse(scopeHeader) as { allCountries: boolean; countryCodes: string[] };
      allCountries = scope.allCountries;
      countryCodes = scope.countryCodes ?? [];
    } catch {
      res.status(400).json({ success: false, message: 'Invalid x-admin-scope header' });
      return;
    }
  }

  const page    = Math.max(1, Number(req.query['page'])  || 1);
  const limit   = Math.min(100, Math.max(1, Number(req.query['limit']) || 20));
  const isActive = req.query['isActive'] !== undefined
    ? req.query['isActive'] === 'true'
    : undefined;
  const search  = req.query['search'] as string | undefined;

  const result = await listUsersForAdmin({
    allCountries,
    countryCodes,
    page,
    limit,
    ...(isActive !== undefined && { isActive }),
    ...(search    !== undefined && { search }),
  });
  res.json({ success: true, ...result });
});

export default router;
