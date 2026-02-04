import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { sessions, userSettings, weeklyReports, projects } from '../../db/schema';
import { eq, and, gte, lte, desc, sql, isNull } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse, toSnakeCase } from './utils/response';
import { getWeekStart, getWeekEnd, getMonthStart, getMonthEnd } from './utils/dateHelpers';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/reports\/?(.*)/);
  return match ? match[1] : '';
}

async function getHourlyRate(userId: number): Promise<number> {
  const rows = await db
    .select({ hourlyRate: userSettings.hourlyRate })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return rows[0]?.hourlyRate || 0;
}

async function handleToday(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.user!.userId),
        gte(sessions.clockIn, today.toISOString()),
        lte(sessions.clockIn, tomorrow.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(auth.user!.userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  return jsonResponse(
    200,
    {
      date: today.toISOString(),
      sessionCount: sessionRows.length,
      totalMs,
      earnings,
    },
    auth.cookies
  );
}

async function handleWeekly(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};
  const targetDate = params.date ? new Date(params.date) : new Date();
  const weekStart = getWeekStart(targetDate);
  const weekEnd = getWeekEnd(targetDate);

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.user!.userId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(auth.user!.userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  // Daily breakdown
  const dailyStats = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
  sessionRows.forEach((session) => {
    const day = new Date(session.clockIn).getDay();
    dailyStats[day] += session.duration;
  });

  return jsonResponse(
    200,
    {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      sessionCount: sessionRows.length,
      totalMs,
      earnings,
      dailyStats,
    },
    auth.cookies
  );
}

async function handleMonthly(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};
  const targetDate = params.date ? new Date(params.date) : new Date();
  const monthStart = getMonthStart(targetDate);
  const monthEnd = getMonthEnd(targetDate);

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.user!.userId),
        gte(sessions.clockIn, monthStart.toISOString()),
        lte(sessions.clockIn, monthEnd.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(auth.user!.userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  return jsonResponse(
    200,
    {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      sessionCount: sessionRows.length,
      totalMs,
      earnings,
    },
    auth.cookies
  );
}

async function handleProjectBreakdown(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};

  // Projects with time
  const conditions = [eq(sessions.userId, auth.user!.userId)];
  if (params.start) conditions.push(gte(sessions.clockIn, params.start));
  if (params.end) conditions.push(lte(sessions.clockIn, params.end));

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      total_ms: sql<number>`COALESCE(SUM(${sessions.duration}), 0)`.as('total_ms'),
      session_count: sql<number>`COUNT(${sessions.id})`.as('session_count'),
    })
    .from(projects)
    .leftJoin(
      sessions,
      and(eq(projects.id, sessions.projectId), ...conditions)
    )
    .where(eq(projects.userId, auth.user!.userId))
    .groupBy(projects.id, projects.name)
    .orderBy(sql`total_ms DESC`);

  // No-project sessions
  const noProjectConditions = [
    eq(sessions.userId, auth.user!.userId),
    isNull(sessions.projectId),
  ];
  if (params.start) noProjectConditions.push(gte(sessions.clockIn, params.start));
  if (params.end) noProjectConditions.push(lte(sessions.clockIn, params.end));

  const noProjectRows = await db
    .select({
      total_ms: sql<number>`COALESCE(SUM(${sessions.duration}), 0)`.as('total_ms'),
      session_count: sql<number>`COUNT(${sessions.id})`.as('session_count'),
    })
    .from(sessions)
    .where(and(...noProjectConditions));

  const noProject = noProjectRows[0] || { total_ms: 0, session_count: 0 };

  return jsonResponse(
    200,
    {
      projects: projectRows,
      noProject: {
        name: 'No Project',
        total_ms: noProject.total_ms,
        session_count: noProject.session_count,
      },
    },
    auth.cookies
  );
}

async function handlePastWeeks(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const reports = await db
    .select()
    .from(weeklyReports)
    .where(eq(weeklyReports.userId, auth.user!.userId))
    .orderBy(desc(weeklyReports.weekStart))
    .limit(12);

  return jsonResponse(200, { reports: toSnakeCase(reports) }, auth.cookies);
}

async function handleGenerateWeekly(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { date } = JSON.parse(event.body || '{}');
  const targetDate = date ? new Date(date) : new Date();
  const weekStart = getWeekStart(targetDate);
  const weekEnd = getWeekEnd(targetDate);
  const weekId = weekStart.toISOString().split('T')[0];

  // Check if already exists
  const existing = await db
    .select()
    .from(weeklyReports)
    .where(
      and(eq(weeklyReports.userId, auth.user!.userId), eq(weeklyReports.weekId, weekId))
    )
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(200, { message: 'Report already exists', report: toSnakeCase(existing[0]) }, auth.cookies);
  }

  // Calculate stats
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, auth.user!.userId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(auth.user!.userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  const [report] = await db
    .insert(weeklyReports)
    .values({
      userId: auth.user!.userId,
      weekId,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      totalMs,
      sessionCount: sessionRows.length,
      earnings,
    })
    .returning();

  return jsonResponse(201, { message: 'Report generated', report: toSnakeCase(report) }, auth.cookies);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    if (method === 'GET' && subpath === 'today') return await handleToday(event);
    if (method === 'GET' && subpath === 'weekly') return await handleWeekly(event);
    if (method === 'GET' && subpath === 'monthly') return await handleMonthly(event);
    if (method === 'GET' && subpath === 'projects') return await handleProjectBreakdown(event);
    if (method === 'GET' && subpath === 'past-weeks') return await handlePastWeeks(event);
    if (method === 'POST' && subpath === 'generate-weekly') return await handleGenerateWeekly(event);

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Reports error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
