import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import {
  getUserProfileByEmail,
  getProfileById,
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
  updateProfileIBStatus,
  isValidReferralCode,
  getDashboardMe,
  getDashboardKyc,
  updateProfileDetails,
  upsertKycDetails,
  softDeleteProfile,
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

  const profile = await getUserProfileByEmail(email);
  if (!profile) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json(profile);
});

/**
 * GET /internal/profiles/:id
 * Fetches a Master Profile by raw ID.
 */
router.get('/profiles/:id', async (req: Request, res: Response) => {
  const profile = await getProfileById(req.params.id!);
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
 * PATCH /internal/profiles/:id/update
 * Updates mutable profile fields (firstName, lastName only).
 * Email, phone, isIB are not user-editable.
 */
router.patch('/profiles/:id/update', async (req: Request, res: Response) => {
  const body = req.body as { firstName?: string; lastName?: string };
  if (body.firstName === undefined && body.lastName === undefined) {
    res.status(400).json({ success: false, message: 'At least one field (firstName, lastName) is required' });
    return;
  }
  const input: { firstName?: string; lastName?: string } = {};
  if (body.firstName !== undefined) input.firstName = body.firstName;
  if (body.lastName !== undefined) input.lastName = body.lastName;
  await updateProfileDetails(req.params.id!, input);
  const updated = await getDashboardMe(req.params.id!);
  res.json({ success: true, data: updated });
});

/**
 * GET /internal/profiles/kyc/:id
 * Fetches Dashboard KYC data.
 */
router.get('/profiles/kyc/:id', async (req: Request, res: Response) => {
  const data = await getDashboardKyc(req.params.id!);
  res.json(data || {});
});

/**
 * PATCH /internal/profiles/kyc/:id/update
 * Upserts KYC details. Enforces required fields on first submission.
 * Locked once kycStatus === 'approved'.
 */
router.patch('/profiles/kyc/:id/update', async (req: Request, res: Response) => {
  const input = req.body as {
    addressLine1?: string; addressLine2?: string; city?: string; country?: string;
    pincode?: string; idProofType?: string; addressProofType?: string;
    idProofPath?: string; addressProofPath?: string;
  };

  try {
    await upsertKycDetails(req.params.id!, input);
    res.json({ success: true });
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'KYC_ALREADY_APPROVED') {
      res.status(403).json({ success: false, code: 'KYC_ALREADY_APPROVED', message: 'KYC is already approved and cannot be modified.' });
      return;
    }
    if (message.startsWith('MISSING_REQUIRED_KYC_FIELDS:')) {
      const missing = message.split(':')[1]!.split(',');
      res.status(422).json({ success: false, code: 'MISSING_KYC_FIELDS', message: 'Required KYC fields are missing for first submission.', fields: missing });
      return;
    }
    if (message === 'NO_LIVE_ACCOUNT') {
      res.status(404).json({ success: false, code: 'NO_LIVE_ACCOUNT', message: 'No live trading account found for this profile.' });
      return;
    }
    throw err;
  }
});

/**
 * DELETE /internal/profiles/:id
 * Soft-deletes a user profile and deactivates all associated accounts.
 * Auth sessions are revoked by auth-service separately after this call.
 */
router.delete('/profiles/:id', async (req: Request, res: Response) => {
  await softDeleteProfile(req.params.id!);
  res.json({ success: true });
});

/**
 * POST /internal/users/by-email/all
 * Returns ALL live accounts for an email.
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
 */
router.get('/accounts/:profileId', async (req: Request, res: Response) => {
  const accounts = await getAllAccountsForProfile(req.params.profileId!);
  res.json({ success: true, data: accounts });
});

/**
 * POST /internal/accounts
 * Create a new trading account under an existing UserProfile.
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

router.get('/users/check-phone/:phone', async (req: Request, res: Response) => {
  const { ownerEmail } = req.query as { ownerEmail?: string };
  const available = await isPhoneAvailable(decodeURIComponent(req.params.phone!), ownerEmail);
  res.json({ success: true, available });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check Referral Code
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * PATCH /internal/profiles/:profileId/ib
 * Updates the isIB status of a UserProfile.
 */
router.patch('/profiles/:profileId/ib', async (req: Request, res: Response) => {
  const { isIB } = req.body as { isIB: boolean };
  if (isIB === undefined) { res.status(400).json({ success: false, message: 'isIB is required' }); return; }
  await updateProfileIBStatus(req.params.profileId!, isIB);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email verification
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/profiles/:profileId/verify-email', async (req: Request, res: Response) => {
  await markProfileVerified(req.params.profileId!);
  res.json({ success: true });
});

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

  const page = Math.max(1, Number(req.query['page']) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20));
  const isActive = req.query['isActive'] !== undefined
    ? req.query['isActive'] === 'true'
    : undefined;
  const search = req.query['search'] as string | undefined;

  const result = await listUsersForAdmin({
    allCountries,
    countryCodes,
    page,
    limit,
    ...(isActive !== undefined && { isActive }),
    ...(search !== undefined && { search }),
  });
  res.json({ success: true, ...result });
});

export default router;
