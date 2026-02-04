const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, generateEmployeeCode } = require('../config/database');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  setTokenCookies,
  clearTokenCookies
} = require('../utils/tokenUtils');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// Register new user
router.post('/register', async (req, res) => {
  try {
    const db = getDb();
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user exists
    const existingUser = db.prepare(
      'SELECT id FROM users WHERE username = ? OR email = ?'
    ).get(username, email);

    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `);
    const result = insertUser.run(username, email, passwordHash);
    const userId = result.lastInsertRowid;

    // Generate unique employee code
    let employeeCode;
    let codeAttempts = 0;
    while (codeAttempts < 10) {
      employeeCode = generateEmployeeCode();
      const existing = db.prepare('SELECT user_id FROM user_settings WHERE employee_code = ?').get(employeeCode);
      if (!existing) break;
      codeAttempts++;
    }

    // Create default settings with employee code
    const insertSettings = db.prepare(`
      INSERT INTO user_settings (user_id, hourly_rate, text_size, employee_code)
      VALUES (?, 0, 'medium', ?)
    `);
    insertSettings.run(userId, employeeCode);

    const user = { id: userId, username, email, is_admin: 0 };

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set cookies
    setTokenCookies(res, accessToken, refreshToken);

    res.status(201).json({
      message: 'Registration successful',
      user: { id: userId, username, email, isAdmin: false }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Register new admin
router.post('/register-admin', async (req, res) => {
  try {
    const db = getDb();
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user exists
    const existingUser = db.prepare(
      'SELECT id FROM users WHERE username = ? OR email = ?'
    ).get(username, email);

    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create admin user
    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, is_admin)
      VALUES (?, ?, ?, 1)
    `);
    const result = insertUser.run(username, email, passwordHash);
    const userId = result.lastInsertRowid;

    // Generate unique employee code
    let employeeCode;
    let codeAttempts = 0;
    while (codeAttempts < 10) {
      employeeCode = generateEmployeeCode();
      const existing = db.prepare('SELECT user_id FROM user_settings WHERE employee_code = ?').get(employeeCode);
      if (!existing) break;
      codeAttempts++;
    }

    // Create default settings with employee code
    const insertSettings = db.prepare(`
      INSERT INTO user_settings (user_id, hourly_rate, text_size, employee_code)
      VALUES (?, 0, 'medium', ?)
    `);
    insertSettings.run(userId, employeeCode);

    const user = { id: userId, username, email, is_admin: 1 };

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set cookies
    setTokenCookies(res, accessToken, refreshToken);

    res.status(201).json({
      message: 'Admin registration successful',
      user: { id: userId, username, email, isAdmin: true }
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const db = getDb();
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user by username or email
    const user = db.prepare(`
      SELECT * FROM users WHERE username = ? OR email = ?
    `).get(username, username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set cookies
    setTokenCookies(res, accessToken, refreshToken);

    res.json({
      message: 'Login successful',
      user: { id: user.id, username: user.username, email: user.email, isAdmin: !!user.is_admin }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    revokeRefreshToken(refreshToken);
  }

  clearTokenCookies(res);
  res.json({ message: 'Logged out successfully' });
});

// Logout from all devices
router.post('/logout-all', authenticate, (req, res) => {
  revokeAllUserTokens(req.user.userId);
  clearTokenCookies(res);
  res.json({ message: 'Logged out from all devices' });
});

// Get current user
router.get('/me', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare(`
    SELECT id, username, email, is_admin, created_at FROM users WHERE id = ?
  `).get(req.user.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: !!user.is_admin,
      created_at: user.created_at
    }
  });
});

// Refresh token
router.post('/refresh', (req, res) => {
  const db = getDb();
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  const storedToken = verifyRefreshToken(refreshToken);
  if (!storedToken) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(storedToken.user_id);

  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Revoke old refresh token
  revokeRefreshToken(refreshToken);

  // Generate new tokens
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  // Set cookies
  setTokenCookies(res, newAccessToken, newRefreshToken);

  res.json({ message: 'Tokens refreshed' });
});

module.exports = router;
