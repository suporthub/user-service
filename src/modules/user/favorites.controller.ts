import { Request, Response } from 'express';
import * as favoritesService from './favorites.service';

export async function getFavorites(req: Request, res: Response) {
  const { sub: userId, userType } = req.user!;
  
  const favorites = await favoritesService.getFavorites(userId, userType);
  res.json({ success: true, data: favorites });
}

export async function addFavorite(req: Request, res: Response) {
  const { sub: userId, userType } = req.user!;
  const { symbol } = req.body as { symbol: string };

  if (!symbol) {
    res.status(400).json({ success: false, message: 'Symbol is required' });
    return;
  }

  const favorite = await favoritesService.addFavorite(userId, userType, symbol);
  res.json({ success: true, data: favorite });
}

export async function removeFavorite(req: Request, res: Response) {
  const { sub: userId, userType } = req.user!;
  const { symbol } = req.params as { symbol: string };

  if (!symbol) {
    res.status(400).json({ success: false, message: 'Symbol is required' });
    return;
  }

  try {
    await favoritesService.removeFavorite(userId, userType, symbol);
    res.json({ success: true, message: 'Favorite removed' });
  } catch (err) {
    // If not found, still return success or specific error
    res.json({ success: true, message: 'Favorite already removed or not found' });
  }
}
