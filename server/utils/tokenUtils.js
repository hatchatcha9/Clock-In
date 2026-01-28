const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('../config/database');

const ACCESS_TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function generateAccessToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

function generateRefreshToken(user) {
  const db = getDb();
  const token = crypto.randomBytes(64).toString('hex');

  // Calculate expiration date
  const expiresAt = new Date();
  const days = parseInt(REFRESH_TOKEN_EXPIRES) || 7;
  expiresAt.setDate(expiresAt.getDate() + days);

  // Store in database
  const stmt = db.prepare(`
    INSERT INTO refresh_tokens (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(user.id, token, expiresAt.toISOString());

  return token;
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function verifyRefreshToken(token) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')
  `);
  return stmt.get(token);
}

function revokeRefreshToken(token) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM refresh_tokens WHERE token = ?');
  stmt.run(token);
}

function revokeAllUserTokens(userId) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?');
  stmt.run(userId);
}

function cleanExpiredTokens() {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')");
  stmt.run();
}

function setTokenCookies(res, accessToken, refreshToken) {
  // Access token cookie - short lived
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  // Refresh token cookie - longer lived
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearTokenCookies(res) {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  cleanExpiredTokens,
  setTokenCookies,
  clearTokenCookies
};
