import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWT authentication middleware for user-facing APIs.
 * Validates the JWT signature and extracts the payload.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    
    if (payload.typ !== 'access' && payload.typ !== 'portal') {
      res.status(401).json({ success: false, message: 'Invalid token type' });
      return;
    }

    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
