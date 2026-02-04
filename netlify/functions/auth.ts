import type { Handler, HandlerEvent } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../db';
import { users, userSettings, passwordResetTokens } from '../../db/schema';
import { eq, or, and, lt } from 'drizzle-orm';
import {
  generateAccessToken,
  generateRefreshTokenAsync,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from './utils/tokenUtils';
import { authenticate } from './utils/auth';
import {
  jsonResponse,
  makeAccessTokenCookie,
  makeRefreshTokenCookie,
  makeClearCookies,
} from './utils/response';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

function generateEmployeeCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  // Extract the subpath after /auth/ - handles both direct and redirected paths
  const authMatch = path.match(/\/auth\/?(.*)/);
  return authMatch ? authMatch[1] : '';
}

async function handleRegister(event: HandlerEvent) {
  const { username, email, password } = JSON.parse(event.body || '{}');

  if (!username || !email || !password) {
    return jsonResponse(400, { error: 'Username, email, and password are required' });
  }
  if (username.length < 3) {
    return jsonResponse(400, { error: 'Username must be at least 3 characters' });
  }
  if (password.length < 8) {
    return jsonResponse(400, { error: 'Password must be at least 8 characters' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return jsonResponse(400, { error: 'Invalid email format' });
  }

  // Check if user exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, email)))
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(409, { error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [newUser] = await db
    .insert(users)
    .values({ username, email, passwordHash })
    .returning({ id: users.id, username: users.username, email: users.email, isAdmin: users.isAdmin });

  // Create default settings with employee code for non-admin users
  const employeeCode = generateEmployeeCode();
  await db.insert(userSettings).values({
    userId: newUser.id,
    hourlyRate: 0,
    textSize: 'medium',
    employeeCode: employeeCode,
  });

  const accessToken = generateAccessToken(newUser);
  const refreshToken = await generateRefreshTokenAsync(newUser);

  return jsonResponse(
    201,
    {
      message: 'Registration successful',
      user: { id: newUser.id, username: newUser.username, email: newUser.email, isAdmin: newUser.isAdmin },
    },
    [makeAccessTokenCookie(accessToken), makeRefreshTokenCookie(refreshToken)]
  );
}

async function handleRegisterAdmin(event: HandlerEvent) {
  const { username, email, password } = JSON.parse(event.body || '{}');

  if (!username || !email || !password) {
    return jsonResponse(400, { error: 'Username, email, and password are required' });
  }
  if (username.length < 3) {
    return jsonResponse(400, { error: 'Username must be at least 3 characters' });
  }
  if (password.length < 8) {
    return jsonResponse(400, { error: 'Password must be at least 8 characters' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return jsonResponse(400, { error: 'Invalid email format' });
  }

  // Check if user exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, email)))
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(409, { error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [newUser] = await db
    .insert(users)
    .values({ username, email, passwordHash, isAdmin: true })
    .returning({ id: users.id, username: users.username, email: users.email, isAdmin: users.isAdmin });

  // Create default settings (no employee code for admins)
  await db.insert(userSettings).values({
    userId: newUser.id,
    hourlyRate: 0,
    textSize: 'medium',
    employeeCode: null,
  });

  const accessToken = generateAccessToken(newUser);
  const refreshToken = await generateRefreshTokenAsync(newUser);

  return jsonResponse(
    201,
    {
      message: 'Admin registration successful',
      user: { id: newUser.id, username: newUser.username, email: newUser.email, isAdmin: newUser.isAdmin },
    },
    [makeAccessTokenCookie(accessToken), makeRefreshTokenCookie(refreshToken)]
  );
}

async function handleLogin(event: HandlerEvent) {
  const { username, password } = JSON.parse(event.body || '{}');

  if (!username || !password) {
    return jsonResponse(400, { error: 'Username and password are required' });
  }

  const userRows = await db
    .select()
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, username)))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return jsonResponse(401, { error: 'Invalid username or password. Please try again.' });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    return jsonResponse(401, { error: 'Invalid username or password. Please try again.' });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshTokenAsync(user);

  return jsonResponse(
    200,
    {
      message: 'Login successful',
      user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin },
    },
    [makeAccessTokenCookie(accessToken), makeRefreshTokenCookie(refreshToken)]
  );
}

async function handleLogout(event: HandlerEvent) {
  const { parse } = await import('cookie');
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = parse(cookieHeader);
  const refreshToken = cookies.refreshToken;

  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  return jsonResponse(200, { message: 'Logged out successfully' }, makeClearCookies());
}

async function handleLogoutAll(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) {
    return jsonResponse(401, { error: auth.error });
  }

  await revokeAllUserTokens(auth.user!.userId);

  return jsonResponse(
    200,
    { message: 'Logged out from all devices' },
    makeClearCookies()
  );
}

async function handleMe(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) {
    return jsonResponse(401, { error: auth.error }, auth.cookies);
  }

  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, auth.user!.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return jsonResponse(404, { error: 'User not found' }, auth.cookies);
  }

  return jsonResponse(200, { user }, auth.cookies);
}

async function handleRefresh(event: HandlerEvent) {
  const { parse } = await import('cookie');
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = parse(cookieHeader);
  const refreshToken = cookies.refreshToken;

  if (!refreshToken) {
    return jsonResponse(401, { error: 'Refresh token required' });
  }

  const storedToken = await verifyRefreshToken(refreshToken);
  if (!storedToken) {
    return jsonResponse(401, { error: 'Invalid refresh token' });
  }

  const userRows = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.id, storedToken.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return jsonResponse(401, { error: 'User not found' });
  }

  // Revoke old, generate new
  await revokeRefreshToken(refreshToken);
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = await generateRefreshTokenAsync(user);

  return jsonResponse(
    200,
    { message: 'Tokens refreshed' },
    [makeAccessTokenCookie(newAccessToken), makeRefreshTokenCookie(newRefreshToken)]
  );
}

async function handleForgotPassword(event: HandlerEvent) {
  const { email } = JSON.parse(event.body || '{}');

  if (!email) {
    return jsonResponse(400, { error: 'Email is required' });
  }

  // Find user by email
  const userRows = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Always return success even if user doesn't exist (security best practice)
  if (userRows.length === 0) {
    return jsonResponse(200, {
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  }

  const user = userRows[0];

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 minute expiration

  // Store token in database
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
    used: false,
  });

  // Send email
  const { sendEmail } = await import('./utils/emailService');
  const resetUrl = `${process.env.URL || 'http://localhost:8888'}/reset-password?token=${token}`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <div style="background-color: #8B7355; padding: 30px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: normal;">Reset Your Password</h1>
      </div>
      <div style="padding: 30px;">
        <p style="margin: 0 0 20px; color: #666; font-size: 16px;">
          Hello <strong>${user.username}</strong>,
        </p>
        <p style="margin: 0 0 20px; color: #666; font-size: 16px;">
          We received a request to reset your password. Click the button below to create a new password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #8B7355; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 4px; font-size: 16px;">Reset Password</a>
        </div>
        <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:
        </p>
        <p style="margin: 0 0 20px; color: #8B7355; font-size: 14px; word-break: break-all;">
          ${resetUrl}
        </p>
        <p style="margin: 0 0 10px; color: #999; font-size: 14px;">
          This link will expire in 30 minutes.
        </p>
        <p style="margin: 0; color: #999; font-size: 14px;">
          If you didn't request this password reset, you can safely ignore this email.
        </p>
      </div>
      <div style="background-color: #FAF8F5; padding: 20px; text-align: center;">
        <p style="margin: 0; color: #999; font-size: 12px;">Sent from Clock In Time Tracker</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password - Clock In',
      html: emailHtml,
    });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return jsonResponse(500, { error: 'Failed to send password reset email' });
  }

  return jsonResponse(200, {
    message: 'If an account with that email exists, a password reset link has been sent.'
  });
}

async function handleResetPassword(event: HandlerEvent) {
  const { token, password } = JSON.parse(event.body || '{}');

  if (!token || !password) {
    return jsonResponse(400, { error: 'Token and password are required' });
  }

  if (password.length < 8) {
    return jsonResponse(400, { error: 'Password must be at least 8 characters' });
  }

  // Find valid token
  const tokenRows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token, token),
        eq(passwordResetTokens.used, false)
      )
    )
    .limit(1);

  if (tokenRows.length === 0) {
    return jsonResponse(400, { error: 'Invalid or expired reset token' });
  }

  const resetToken = tokenRows[0];

  // Check if token is expired
  if (new Date() > new Date(resetToken.expiresAt)) {
    return jsonResponse(400, { error: 'Invalid or expired reset token' });
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Update user password
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, resetToken.userId));

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ used: true })
    .where(eq(passwordResetTokens.id, resetToken.id));

  // Revoke all existing sessions for security
  await revokeAllUserTokens(resetToken.userId);

  return jsonResponse(200, { message: 'Password reset successfully. You can now log in with your new password.' });
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    if (method === 'POST' && subpath === 'register') return await handleRegister(event);
    if (method === 'POST' && subpath === 'register-admin') return await handleRegisterAdmin(event);
    if (method === 'POST' && subpath === 'login') return await handleLogin(event);
    if (method === 'POST' && subpath === 'logout') return await handleLogout(event);
    if (method === 'POST' && subpath === 'logout-all') return await handleLogoutAll(event);
    if (method === 'GET' && subpath === 'me') return await handleMe(event);
    if (method === 'POST' && subpath === 'refresh') return await handleRefresh(event);
    if (method === 'POST' && subpath === 'forgot-password') return await handleForgotPassword(event);
    if (method === 'POST' && subpath === 'reset-password') return await handleResetPassword(event);

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Auth error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
