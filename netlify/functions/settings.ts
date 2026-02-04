import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { userSettings } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse } from './utils/response';

async function handleGetSettings(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  let settingsRows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, auth.user!.userId))
    .limit(1);

  if (settingsRows.length === 0) {
    await db.insert(userSettings).values({
      userId: auth.user!.userId,
      hourlyRate: 0,
      textSize: 'medium',
    });
    settingsRows = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, auth.user!.userId))
      .limit(1);
  }

  const s = settingsRows[0];
  return jsonResponse(
    200,
    { settings: { hourlyRate: s.hourlyRate, textSize: s.textSize, employeeCode: s.employeeCode } },
    auth.cookies
  );
}

async function handleUpdateSettings(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { hourlyRate, textSize } = JSON.parse(event.body || '{}');

  const validSizes = ['small', 'medium', 'large'];
  if (textSize && !validSizes.includes(textSize)) {
    return jsonResponse(400, { error: 'Invalid text size' }, auth.cookies);
  }
  if (hourlyRate !== undefined && (typeof hourlyRate !== 'number' || hourlyRate < 0)) {
    return jsonResponse(400, { error: 'Invalid hourly rate' }, auth.cookies);
  }

  const existing = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, auth.user!.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userSettings).values({
      userId: auth.user!.userId,
      hourlyRate: hourlyRate !== undefined ? hourlyRate : 0,
      textSize: textSize || 'medium',
    });
  } else {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (hourlyRate !== undefined) updates.hourlyRate = hourlyRate;
    if (textSize) updates.textSize = textSize;

    await db
      .update(userSettings)
      .set(updates)
      .where(eq(userSettings.userId, auth.user!.userId));
  }

  const settingsRows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, auth.user!.userId))
    .limit(1);

  const s = settingsRows[0];
  return jsonResponse(
    200,
    {
      message: 'Settings updated',
      settings: { hourlyRate: s.hourlyRate, textSize: s.textSize, employeeCode: s.employeeCode },
    },
    auth.cookies
  );
}

export const handler: Handler = async (event) => {
  const method = event.httpMethod;

  try {
    if (method === 'GET') return await handleGetSettings(event);
    if (method === 'PUT') return await handleUpdateSettings(event);

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Settings error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
