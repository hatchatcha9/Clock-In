import { parse } from 'cookie';
import { db } from '../../../db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import {
  verifyAccessToken,
  verifyRefreshToken,
  generateAccessToken,
} from './tokenUtils';
import {
  makeAccessTokenCookie,
  type CookieDefinition,
} from './response';

import type { HandlerEvent } from '@netlify/functions';

interface AuthResult {
  user: { userId: number; username: string } | null;
  cookies: CookieDefinition[];
  error: string | null;
}

export async function authenticate(event: HandlerEvent): Promise<AuthResult> {
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = parse(cookieHeader);

  const accessToken = cookies.accessToken;
  const refreshToken = cookies.refreshToken;

  if (!accessToken && !refreshToken) {
    return { user: null, cookies: [], error: 'Authentication required' };
  }

  // Try access token first
  const decoded = verifyAccessToken(accessToken);
  if (decoded) {
    return {
      user: { userId: decoded.userId, username: decoded.username },
      cookies: [],
      error: null,
    };
  }

  // Access token expired/invalid, try refresh token
  if (!refreshToken) {
    return { user: null, cookies: [], error: 'Authentication required' };
  }

  const storedToken = await verifyRefreshToken(refreshToken);
  if (!storedToken) {
    return { user: null, cookies: [], error: 'Invalid refresh token' };
  }

  // Get user from database
  const userRows = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.id, storedToken.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return { user: null, cookies: [], error: 'User not found' };
  }

  // Generate new access token
  const newAccessToken = generateAccessToken(user);

  return {
    user: { userId: user.id, username: user.username },
    cookies: [makeAccessTokenCookie(newAccessToken)],
    error: null,
  };
}
