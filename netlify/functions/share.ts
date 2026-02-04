import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { sessions, projects, users, userSettings } from '../../db/schema';
import { eq, and, gte, lte, lt, sql, isNull } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse, htmlResponse } from './utils/response';
import { getWeekStart, getWeekEnd } from './utils/dateHelpers';
import {
  sendEmail,
  generateDailyReportEmail,
  generateWeeklyReportEmail,
  formatDate,
} from './utils/emailService';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/share\/?(.*)/);
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

async function getUsername(userId: number): Promise<string> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username || 'Unknown';
}

async function getDailyData(userId: number, targetDate: Date) {
  targetDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const sessionRows = await db
    .select({
      id: sessions.id,
      clock_in: sessions.clockIn,
      clock_out: sessions.clockOut,
      duration: sessions.duration,
      project_name: projects.name,
      notes: sessions.notes,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.clockIn, targetDate.toISOString()),
        lt(sessions.clockIn, nextDay.toISOString())
      )
    )
    .orderBy(sessions.clockIn);

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;
  const username = await getUsername(userId);

  return { username, date: targetDate.toISOString(), sessions: sessionRows, totalMs, earnings, hourlyRate };
}

async function getWeeklyData(userId: number, targetDate: Date) {
  const weekStart = getWeekStart(targetDate);
  const weekEnd = getWeekEnd(targetDate);

  const sessionRows = await db
    .select({
      id: sessions.id,
      clock_in: sessions.clockIn,
      clock_out: sessions.clockOut,
      duration: sessions.duration,
      project_name: projects.name,
      notes: sessions.notes,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    )
    .orderBy(sessions.clockIn);

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);
  const hourlyRate = await getHourlyRate(userId);
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;
  const username = await getUsername(userId);

  // Daily breakdown
  const dailyStats = [0, 0, 0, 0, 0, 0, 0];
  sessionRows.forEach((session) => {
    const day = new Date(session.clock_in).getDay();
    dailyStats[day] += session.duration;
  });

  // Project breakdown
  const projectBreakdown = await db
    .select({
      name: sql<string>`COALESCE(${projects.name}, 'No Project')`.as('name'),
      total_ms: sql<number>`SUM(${sessions.duration})`.as('total_ms'),
      session_count: sql<number>`COUNT(${sessions.id})`.as('session_count'),
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    )
    .groupBy(sql`COALESCE(${projects.name}, 'No Project')`)
    .orderBy(sql`total_ms DESC`);

  return {
    username,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    sessions: sessionRows,
    totalMs,
    earnings,
    hourlyRate,
    dailyStats,
    projectBreakdown,
  };
}

async function handleShareDaily(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { email, date } = JSON.parse(event.body || '{}');

  if (!email) {
    return jsonResponse(400, { error: 'Email address is required' }, auth.cookies);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return jsonResponse(400, { error: 'Invalid email format' }, auth.cookies);
  }

  const targetDate = date ? new Date(date) : new Date();
  const data = await getDailyData(auth.user!.userId, targetDate);
  const html = generateDailyReportEmail(data);

  await sendEmail({
    to: email,
    subject: `Daily Time Report - ${formatDate(data.date)}`,
    html,
  });

  return jsonResponse(200, { message: 'Daily report sent successfully', sentTo: email }, auth.cookies);
}

async function handleShareWeekly(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { email, date } = JSON.parse(event.body || '{}');

  if (!email) {
    return jsonResponse(400, { error: 'Email address is required' }, auth.cookies);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return jsonResponse(400, { error: 'Invalid email format' }, auth.cookies);
  }

  const targetDate = date ? new Date(date) : new Date();
  const data = await getWeeklyData(auth.user!.userId, targetDate);
  const html = generateWeeklyReportEmail(data);

  await sendEmail({
    to: email,
    subject: `Weekly Time Report - Week of ${formatDate(data.weekStart)}`,
    html,
  });

  return jsonResponse(200, { message: 'Weekly report sent successfully', sentTo: email }, auth.cookies);
}

async function handlePreviewDaily(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};
  const targetDate = params.date ? new Date(params.date) : new Date();
  const data = await getDailyData(auth.user!.userId, targetDate);
  const html = generateDailyReportEmail(data);

  return htmlResponse(200, html);
}

async function handlePreviewWeekly(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const params = event.queryStringParameters || {};
  const targetDate = params.date ? new Date(params.date) : new Date();
  const data = await getWeeklyData(auth.user!.userId, targetDate);
  const html = generateWeeklyReportEmail(data);

  return htmlResponse(200, html);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    if (method === 'POST' && subpath === 'daily') return await handleShareDaily(event);
    if (method === 'POST' && subpath === 'weekly') return await handleShareWeekly(event);
    if (method === 'GET' && subpath === 'preview/daily') return await handlePreviewDaily(event);
    if (method === 'GET' && subpath === 'preview/weekly') return await handlePreviewWeekly(event);

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Share error:', error);
    return jsonResponse(500, { error: (error as Error).message || 'Internal server error' });
  }
};
