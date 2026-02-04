const { verifyAccessToken, verifyRefreshToken, generateAccessToken, setTokenCookies } = require('../utils/tokenUtils');
const { getDb } = require('../config/database');

function authenticate(req, res, next) {
  const db = getDb();
  const accessToken = req.cookies.accessToken;
  const refreshToken = req.cookies.refreshToken;

  if (!accessToken && !refreshToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Try to verify access token first
  let decoded = verifyAccessToken(accessToken);

  if (decoded) {
    req.user = decoded;
    return next();
  }

  // Access token expired or invalid, try refresh token
  if (!refreshToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const storedToken = verifyRefreshToken(refreshToken);
  if (!storedToken) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Get user from database
  const userStmt = db.prepare('SELECT id, username, email, is_admin FROM users WHERE id = ?');
  const user = userStmt.get(storedToken.user_id);

  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Generate new access token
  const newAccessToken = generateAccessToken(user);

  // Set new access token cookie
  res.cookie('accessToken', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000
  });

  req.user = { userId: user.id, username: user.username, isAdmin: !!user.is_admin };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
