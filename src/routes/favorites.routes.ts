import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as favoritesController from '../modules/user/favorites.controller';

const router = Router();

// All favorite routes require JWT authentication
router.use(authenticate);

/**
 * GET /api/favorites
 * List all favorite symbols for the current trading account.
 */
router.get('/', favoritesController.getFavorites);

/**
 * POST /api/favorites
 * Add a symbol to favorites.
 * Body: { "symbol": "XAUUSD" }
 */
router.post('/', favoritesController.addFavorite);

/**
 * DELETE /api/favorites/:symbol
 * Remove a symbol from favorites.
 */
router.delete('/:symbol', favoritesController.removeFavorite);

export default router;
