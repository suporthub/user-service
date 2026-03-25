import { Router, Request, Response } from 'express';
import { COUNTRIES } from '../data/countries';

/**
 * Countries routes — public reference endpoints used by the frontend
 * to populate country dropdowns for registration and admin GBAC scope selection.
 *
 * No authentication required — these are read-only reference data.
 * Response is cached at the HTTP layer (Cache-Control: max-age=86400).
 */
const router = Router();

// ── Cache header helper (SRP: keep route handlers clean) ──────────────────────
function withCache(res: Response, maxAgeSeconds = 86_400): void {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}`);
}

/**
 * GET /api/countries
 * Returns the full list of countries sorted alphabetically.
 * Response: [{ code, name, dialCode }]
 */
router.get('/', (_req: Request, res: Response) => {
  withCache(res);
  res.json({ success: true, data: COUNTRIES });
});

/**
 * GET /api/countries/:code
 * Returns a single country by ISO-2 code.
 */
router.get('/:code', (req: Request, res: Response) => {
  const code    = (req.params['code'] ?? '').toUpperCase();
  const country = COUNTRIES.find((c) => c.code === code);
  if (!country) {
    res.status(404).json({ success: false, message: `Country code '${code}' not found` });
    return;
  }
  withCache(res);
  res.json({ success: true, data: country });
});

export default router;
