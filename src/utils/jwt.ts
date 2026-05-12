import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface JwtPayload {
  jti: string;
  sub: string;     // user UUID
  sid: string;     // session UUID
  typ: 'access' | 'refresh' | 'login_pending' | 'portal';
  userType: string;
  accountNumber: string;
  scope?: 'portal' | 'trading';
  groupName?: string;
  currency?: string;
  permissions?: string[];
  allCountries?: boolean;
  countryCodes?: string[];
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, {
    issuer: 'livefxhub-auth',
    audience: 'livefxhub-api',
  }) as JwtPayload;
}
