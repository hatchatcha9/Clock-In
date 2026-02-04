import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { sessions, activeSessions, projects } from '../../db/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse, toSnakeCase } from './utils/response';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/sessions\/?(.*)/);
  return match ? match[1] : '';
}

async function handleGetSessions(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};
  const limit = parseInt(params.limit || '100');
  const offset = parseInt(params.offset || '0');

  let query = db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      clockIn: sessions.clockIn,
      clockOut: sessions.clockOut,
      duration: sessions.duration,
      projectId: sessions.projectId,
      notes: sessions.notes,
      createdAt: sessions.createdAt,
      project_name: projects.name,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.userId, auth.user!.userId),
        params.start ? gte(sessions.clockIn, params.start) : undefined,
        params.end ? lte(sessions.clockIn, params.end) : undefined
      )
    )
    .orderBy(desc(sessions.clockIn))
    .limit(limit)
    .offset(offset);

  const sessionList = await query;

  return jsonResponse(200, { sessions: toSnakeCase(sessionList) }, auth.cookies);
}

async function handleGetActive(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const rows = await db
    .select({
      userId: activeSessions.userId,
      clockIn: activeSessions.clockIn,
      projectId: activeSessions.projectId,
      breakTime: activeSessions.breakTime,
      isOnBreak: activeSessions.isOnBreak,
      breakStart: activeSessions.breakStart,
      createdAt: activeSessions.createdAt,
      project_name: projects.name,
    })
    .from(activeSessions)
    .leftJoin(projects, eq(activeSessions.projectId, projects.id))
    .where(eq(activeSessions.userId, auth.user!.userId))
    .limit(1);

  return jsonResponse(200, { active: rows[0] ? toSnakeCase(rows[0]) : null }, auth.cookies);
}

async function handleClockIn(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { projectId } = JSON.parse(event.body || '{}');

  // Check if already clocked in
  const existing = await db
    .select()
    .from(activeSessions)
    .where(eq(activeSessions.userId, auth.user!.userId))
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(400, { error: 'Already clocked in' }, auth.cookies);
  }

  const clockIn = new Date().toISOString();

  await db.insert(activeSessions).values({
    userId: auth.user!.userId,
    clockIn,
    projectId: projectId || null,
    breakTime: 0,
    isOnBreak: false,
  });

  const rows = await db
    .select({
      userId: activeSessions.userId,
      clockIn: activeSessions.clockIn,
      projectId: activeSessions.projectId,
      breakTime: activeSessions.breakTime,
      isOnBreak: activeSessions.isOnBreak,
      breakStart: activeSessions.breakStart,
      createdAt: activeSessions.createdAt,
      project_name: projects.name,
    })
    .from(activeSessions)
    .leftJoin(projects, eq(activeSessions.projectId, projects.id))
    .where(eq(activeSessions.userId, auth.user!.userId))
    .limit(1);

  return jsonResponse(201, { message: 'Clocked in', active: toSnakeCase(rows[0]) }, auth.cookies);
}

async function handleClockOut(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { notes } = JSON.parse(event.body || '{}');

  const activeRows = await db
    .select()
    .from(activeSessions)
    .where(eq(activeSessions.userId, auth.user!.userId))
    .limit(1);

  const active = activeRows[0];
  if (!active) {
    return jsonResponse(400, { error: 'Not clocked in' }, auth.cookies);
  }

  const clockOut = new Date();
  const clockInDate = new Date(active.clockIn);

  let totalBreakTime = active.breakTime || 0;
  if (active.isOnBreak && active.breakStart) {
    totalBreakTime += clockOut.getTime() - new Date(active.breakStart).getTime();
  }

  const duration = clockOut.getTime() - clockInDate.getTime() - totalBreakTime;

  // Create completed session
  const [newSession] = await db
    .insert(sessions)
    .values({
      userId: auth.user!.userId,
      clockIn: active.clockIn,
      clockOut: clockOut.toISOString(),
      duration,
      projectId: active.projectId,
      notes: notes || null,
    })
    .returning();

  // Remove active session
  await db.delete(activeSessions).where(eq(activeSessions.userId, auth.user!.userId));

  // Fetch with project name
  const sessionRows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      clockIn: sessions.clockIn,
      clockOut: sessions.clockOut,
      duration: sessions.duration,
      projectId: sessions.projectId,
      notes: sessions.notes,
      createdAt: sessions.createdAt,
      project_name: projects.name,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(eq(sessions.id, newSession.id))
    .limit(1);

  return jsonResponse(200, { message: 'Clocked out', session: toSnakeCase(sessionRows[0]) }, auth.cookies);
}

async function handleToggleBreak(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const activeRows = await db
    .select()
    .from(activeSessions)
    .where(eq(activeSessions.userId, auth.user!.userId))
    .limit(1);

  const active = activeRows[0];
  if (!active) {
    return jsonResponse(400, { error: 'Not clocked in' }, auth.cookies);
  }

  if (active.isOnBreak) {
    // End break
    const breakEnd = new Date();
    const breakStart = new Date(active.breakStart!);
    const breakDuration = breakEnd.getTime() - breakStart.getTime();
    const newBreakTime = (active.breakTime || 0) + breakDuration;

    await db
      .update(activeSessions)
      .set({ isOnBreak: false, breakStart: null, breakTime: newBreakTime })
      .where(eq(activeSessions.userId, auth.user!.userId));

    return jsonResponse(
      200,
      { message: 'Break ended', isOnBreak: false, breakTime: newBreakTime },
      auth.cookies
    );
  } else {
    // Start break
    const breakStart = new Date().toISOString();

    await db
      .update(activeSessions)
      .set({ isOnBreak: true, breakStart })
      .where(eq(activeSessions.userId, auth.user!.userId));

    return jsonResponse(
      200,
      { message: 'Break started', isOnBreak: true, breakStart },
      auth.cookies
    );
  }
}

async function handleUpdateSession(event: HandlerEvent, id: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { clockIn, clockOut, projectId, notes } = JSON.parse(event.body || '{}');

  // Verify ownership
  const existing = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, auth.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    return jsonResponse(404, { error: 'Session not found' }, auth.cookies);
  }

  const session = existing[0];
  const newClockIn = clockIn ? new Date(clockIn) : new Date(session.clockIn);
  const newClockOut = clockOut ? new Date(clockOut) : new Date(session.clockOut);
  const duration = newClockOut.getTime() - newClockIn.getTime();

  if (duration <= 0) {
    return jsonResponse(400, { error: 'Clock out must be after clock in' }, auth.cookies);
  }

  // Validate times aren't in the future
  const now = new Date();
  if (newClockIn > now) {
    return jsonResponse(400, { error: 'Clock in time cannot be in the future' }, auth.cookies);
  }
  if (newClockOut > now) {
    return jsonResponse(400, { error: 'Clock out time cannot be in the future' }, auth.cookies);
  }

  // Validate session isn't unreasonably long (more than 24 hours)
  const maxDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  if (duration > maxDuration) {
    return jsonResponse(400, { error: 'Session cannot be longer than 24 hours' }, auth.cookies);
  }

  // Validate times aren't too far in the past (more than 1 year)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (newClockIn < oneYearAgo) {
    return jsonResponse(400, { error: 'Clock in time cannot be more than 1 year in the past' }, auth.cookies);
  }

  await db
    .update(sessions)
    .set({
      clockIn: newClockIn.toISOString(),
      clockOut: newClockOut.toISOString(),
      duration,
      projectId: projectId !== undefined ? projectId : session.projectId,
      notes: notes !== undefined ? notes : session.notes,
    })
    .where(and(eq(sessions.id, id), eq(sessions.userId, auth.user!.userId)));

  const updatedRows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      clockIn: sessions.clockIn,
      clockOut: sessions.clockOut,
      duration: sessions.duration,
      projectId: sessions.projectId,
      notes: sessions.notes,
      createdAt: sessions.createdAt,
      project_name: projects.name,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(eq(sessions.id, id))
    .limit(1);

  return jsonResponse(200, { message: 'Session updated', session: toSnakeCase(updatedRows[0]) }, auth.cookies);
}

async function handleDeleteSession(event: HandlerEvent, id: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const existing = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, auth.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    return jsonResponse(404, { error: 'Session not found' }, auth.cookies);
  }

  await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, auth.user!.userId)));

  return jsonResponse(200, { message: 'Session deleted' }, auth.cookies);
}

async function handleCreateSession(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { clockIn, clockOut, projectId, notes } = JSON.parse(event.body || '{}');

  if (!clockIn || !clockOut) {
    return jsonResponse(400, { error: 'Clock in and clock out times are required' }, auth.cookies);
  }

  const clockInDate = new Date(clockIn);
  const clockOutDate = new Date(clockOut);
  const duration = clockOutDate.getTime() - clockInDate.getTime();

  if (duration <= 0) {
    return jsonResponse(400, { error: 'Clock out must be after clock in' }, auth.cookies);
  }

  // Validate times aren't in the future
  const now = new Date();
  if (clockInDate > now) {
    return jsonResponse(400, { error: 'Clock in time cannot be in the future' }, auth.cookies);
  }
  if (clockOutDate > now) {
    return jsonResponse(400, { error: 'Clock out time cannot be in the future' }, auth.cookies);
  }

  // Validate session isn't unreasonably long (more than 24 hours)
  const maxDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  if (duration > maxDuration) {
    return jsonResponse(400, { error: 'Session cannot be longer than 24 hours' }, auth.cookies);
  }

  // Validate times aren't too far in the past (more than 1 year)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (clockInDate < oneYearAgo) {
    return jsonResponse(400, { error: 'Clock in time cannot be more than 1 year in the past' }, auth.cookies);
  }

  const [newSession] = await db
    .insert(sessions)
    .values({
      userId: auth.user!.userId,
      clockIn: clockInDate.toISOString(),
      clockOut: clockOutDate.toISOString(),
      duration,
      projectId: projectId || null,
      notes: notes || null,
    })
    .returning();

  const sessionRows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      clockIn: sessions.clockIn,
      clockOut: sessions.clockOut,
      duration: sessions.duration,
      projectId: sessions.projectId,
      notes: sessions.notes,
      createdAt: sessions.createdAt,
      project_name: projects.name,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(eq(sessions.id, newSession.id))
    .limit(1);

  return jsonResponse(201, { message: 'Session created', session: toSnakeCase(sessionRows[0]) }, auth.cookies);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    // Route dispatch
    if (method === 'GET' && !subpath) return await handleGetSessions(event);
    if (method === 'GET' && subpath === 'active') return await handleGetActive(event);
    if (method === 'POST' && subpath === 'clock-in') return await handleClockIn(event);
    if (method === 'POST' && subpath === 'clock-out') return await handleClockOut(event);
    if (method === 'POST' && subpath === 'break') return await handleToggleBreak(event);
    if (method === 'POST' && !subpath) return await handleCreateSession(event);

    // ID-based routes
    const id = parseInt(subpath);
    if (!isNaN(id)) {
      if (method === 'PUT') return await handleUpdateSession(event, id);
      if (method === 'DELETE') return await handleDeleteSession(event, id);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Sessions error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
