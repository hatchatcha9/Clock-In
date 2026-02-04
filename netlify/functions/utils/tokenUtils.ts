import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../../db';
import { refreshTokens } from '../../../db/schema';
import { eq, and, gt } from 'drizzle-orm';

const ACCESS_TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

interface UserPayload {
  id: number;
  username: string;
  email?: string;
}

interface DecodedToken {
  userId: number;
  username: string;
  iat?: number;
  exp?: number;
}

export function generateAccessToken(user: UserPayload): string {
  return jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

export function generateRefreshToken(user: UserPayload): string {
  const token = crypto.randomBytes(64).toString('hex');

  const expiresAt = new Date();
  const days = parseInt(REFRESH_TOKEN_EXPIRES) || 7;
  expiresAt.setDate(expiresAt.getDate() + days);

  // Store in database (fire-and-forget since this is sync return)
  db.insert(refreshTokens)
    .values({
      userId: user.id,
      token,
      expiresAt: expiresAt.toISOString(),
    })
    .execute();

  return token;
}

export async function generateRefreshTokenAsync(
  user: UserPayload
): Promise<string> {
  const token = crypto.randomBytes(64).toString('hex');

  const expiresAt = new Date();
  const days = parseInt(REFRESH_TOKEN_EXPIRES) || 7;
  expiresAt.setDate(expiresAt.getDate() + days);

  await db.insert(refreshTokens).values({
    userId: user.id,
    token,
    expiresAt: expiresAt.toISOString(),
  });

  return token;
}

export function verifyAccessToken(token: string | undefined): DecodedToken | null {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(
  token: string
): Promise<{ userId: number; token: string; expiresAt: string } | null> {
  const now = new Date().toISOString();
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.token, token), gt(refreshTokens.expiresAt, now)))
    .limit(1);

  return rows[0]
    ? { userId: rows[0].userId, token: rows[0].token, expiresAt: rows[0].expiresAt }
    : null;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
}

export async function revokeAllUserTokens(userId: number): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}

export async function cleanExpiredTokens(): Promise<void> {
  const now = new Date().toISOString();
  await db.delete(refreshTokens).where(gt(refreshTokens.expiresAt, now));
}
