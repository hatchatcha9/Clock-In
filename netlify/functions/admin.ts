import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { adminEmployees, users, userSettings, sessions, activeSessions, projects, weeklyReports } from '../../db/schema';
import { eq, and, desc, gte, lte, lt, sql } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse } from './utils/response';
import { getWeekStart, getWeekEnd } from './utils/dateHelpers';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/admin\/?(.*)/);
  return match ? match[1] : '';
}

async function checkIsAdmin(userId: number): Promise<boolean> {
  const userRows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return userRows[0]?.isAdmin || false;
}

async function handleGetEmployees(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  const employeeList = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(adminEmployees)
    .innerJoin(users, eq(adminEmployees.employeeId, users.id))
    .where(eq(adminEmployees.adminId, auth.user!.userId))
    .orderBy(desc(adminEmployees.createdAt));

  // Fetch active sessions for each employee
  const employeesWithSessions = await Promise.all(
    employeeList.map(async (emp) => {
      const activeRows = await db
        .select({
          clockIn: activeSessions.clockIn,
          isOnBreak: activeSessions.isOnBreak,
          projectId: activeSessions.projectId,
          projectName: projects.name,
        })
        .from(activeSessions)
        .leftJoin(projects, eq(activeSessions.projectId, projects.id))
        .where(eq(activeSessions.userId, emp.id))
        .limit(1);

      return {
        ...emp,
        activeSession: activeRows[0] || null,
      };
    })
  );

  return jsonResponse(200, { employees: employeesWithSessions }, auth.cookies);
}

async function handleAddEmployee(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  const { code } = JSON.parse(event.body || '{}');

  if (!code) {
    return jsonResponse(400, { error: 'Employee code is required' }, auth.cookies);
  }

  // Find user by employee code
  const settingsRows = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(eq(userSettings.employeeCode, code))
    .limit(1);

  if (settingsRows.length === 0) {
    return jsonResponse(404, { error: 'Invalid employee code' }, auth.cookies);
  }

  const employeeId = settingsRows[0].userId;

  // Check if employee is an admin
  const employeeRows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, employeeId))
    .limit(1);

  if (employeeRows[0]?.isAdmin) {
    return jsonResponse(400, { error: 'Cannot add an admin as an employee' }, auth.cookies);
  }

  // Check if already linked
  const existing = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(409, { error: 'Employee already linked' }, auth.cookies);
  }

  // Link the employee
  await db.insert(adminEmployees).values({
    adminId: auth.user!.userId,
    employeeId: employeeId,
  });

  // Get employee details
  const employee = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, employeeId))
    .limit(1);

  return jsonResponse(201, { message: 'Employee added successfully', employee: employee[0] }, auth.cookies);
}

async function handleRemoveEmployee(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  await db
    .delete(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    );

  return jsonResponse(200, { message: 'Employee removed successfully' }, auth.cookies);
}

async function handleGetEmployeeSessions(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  // Verify employee is linked to this admin
  const linked = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (linked.length === 0) {
    return jsonResponse(403, { error: 'Employee not linked to this admin' }, auth.cookies);
  }

  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '100'), 500);

  const sessionRows = await db
    .select({
      id: sessions.id,
      clockIn: sessions.clockIn,
      clockOut: sessions.clockOut,
      duration: sessions.duration,
      projectName: projects.name,
      notes: sessions.notes,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(eq(sessions.userId, employeeId))
    .orderBy(desc(sessions.clockIn))
    .limit(limit);

  return jsonResponse(200, { sessions: sessionRows }, auth.cookies);
}

async function handleGetEmployeeActive(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  // Verify employee is linked to this admin
  const linked = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (linked.length === 0) {
    return jsonResponse(403, { error: 'Employee not linked to this admin' }, auth.cookies);
  }

  const activeRows = await db
    .select({
      userId: activeSessions.userId,
      clockIn: activeSessions.clockIn,
      projectId: activeSessions.projectId,
      projectName: projects.name,
      breakTime: activeSessions.breakTime,
      isOnBreak: activeSessions.isOnBreak,
      breakStart: activeSessions.breakStart,
    })
    .from(activeSessions)
    .leftJoin(projects, eq(activeSessions.projectId, projects.id))
    .where(eq(activeSessions.userId, employeeId))
    .limit(1);

  return jsonResponse(200, { activeSession: activeRows[0] || null }, auth.cookies);
}

async function handleGetEmployeeTodayReport(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  // Verify employee is linked to this admin
  const linked = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (linked.length === 0) {
    return jsonResponse(403, { error: 'Employee not linked to this admin' }, auth.cookies);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const sessionRows = await db
    .select({
      duration: sessions.duration,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, employeeId),
        gte(sessions.clockIn, today.toISOString()),
        lt(sessions.clockIn, tomorrow.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);

  // Get hourly rate
  const settingsRows = await db
    .select({ hourlyRate: userSettings.hourlyRate })
    .from(userSettings)
    .where(eq(userSettings.userId, employeeId))
    .limit(1);

  const hourlyRate = settingsRows[0]?.hourlyRate || 0;
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  return jsonResponse(
    200,
    {
      totalMs,
      sessionCount: sessionRows.length,
      earnings,
    },
    auth.cookies
  );
}

async function handleGetEmployeeWeeklyReport(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  // Verify employee is linked to this admin
  const linked = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (linked.length === 0) {
    return jsonResponse(403, { error: 'Employee not linked to this admin' }, auth.cookies);
  }

  const weekStart = getWeekStart(new Date());
  const weekEnd = getWeekEnd(new Date());

  const sessionRows = await db
    .select({
      duration: sessions.duration,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, employeeId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    );

  const totalMs = sessionRows.reduce((sum, s) => sum + s.duration, 0);

  // Get hourly rate
  const settingsRows = await db
    .select({ hourlyRate: userSettings.hourlyRate })
    .from(userSettings)
    .where(eq(userSettings.userId, employeeId))
    .limit(1);

  const hourlyRate = settingsRows[0]?.hourlyRate || 0;
  const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

  return jsonResponse(
    200,
    {
      totalMs,
      sessionCount: sessionRows.length,
      earnings,
    },
    auth.cookies
  );
}

async function handleGetEmployeeProjectBreakdown(event: HandlerEvent, employeeId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const isAdmin = await checkIsAdmin(auth.user!.userId);
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  // Verify employee is linked to this admin
  const linked = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, employeeId)
      )
    )
    .limit(1);

  if (linked.length === 0) {
    return jsonResponse(403, { error: 'Employee not linked to this admin' }, auth.cookies);
  }

  const weekStart = getWeekStart(new Date());
  const weekEnd = getWeekEnd(new Date());

  const projectBreakdown = await db
    .select({
      name: sql<string>`COALESCE(${projects.name}, 'No Project')`.as('name'),
      totalMs: sql<number>`SUM(${sessions.duration})`.as('total_ms'),
      sessionCount: sql<number>`COUNT(${sessions.id})`.as('session_count'),
    })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.userId, employeeId),
        gte(sessions.clockIn, weekStart.toISOString()),
        lte(sessions.clockIn, weekEnd.toISOString())
      )
    )
    .groupBy(sql`COALESCE(${projects.name}, 'No Project')`)
    .orderBy(sql`total_ms DESC`);

  return jsonResponse(200, { projectBreakdown }, auth.cookies);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    // GET /admin/employees
    if (method === 'GET' && subpath === 'employees') {
      return await handleGetEmployees(event);
    }

    // POST /admin/employees/add
    if (method === 'POST' && subpath === 'employees/add') {
      return await handleAddEmployee(event);
    }

    // DELETE /admin/employees/:id
    if (method === 'DELETE' && subpath.startsWith('employees/')) {
      const parts = subpath.split('/');
      if (parts.length === 2) {
        const employeeId = parseInt(parts[1]);
        if (!isNaN(employeeId)) {
          return await handleRemoveEmployee(event, employeeId);
        }
      }
    }

    // GET /admin/employees/:id/sessions
    if (method === 'GET' && subpath.match(/^employees\/\d+\/sessions$/)) {
      const employeeId = parseInt(subpath.split('/')[1]);
      return await handleGetEmployeeSessions(event, employeeId);
    }

    // GET /admin/employees/:id/active
    if (method === 'GET' && subpath.match(/^employees\/\d+\/active$/)) {
      const employeeId = parseInt(subpath.split('/')[1]);
      return await handleGetEmployeeActive(event, employeeId);
    }

    // GET /admin/employees/:id/reports/today
    if (method === 'GET' && subpath.match(/^employees\/\d+\/reports\/today$/)) {
      const employeeId = parseInt(subpath.split('/')[1]);
      return await handleGetEmployeeTodayReport(event, employeeId);
    }

    // GET /admin/employees/:id/reports/weekly
    if (method === 'GET' && subpath.match(/^employees\/\d+\/reports\/weekly$/)) {
      const employeeId = parseInt(subpath.split('/')[1]);
      return await handleGetEmployeeWeeklyReport(event, employeeId);
    }

    // GET /admin/employees/:id/reports/projects
    if (method === 'GET' && subpath.match(/^employees\/\d+\/reports\/projects$/)) {
      const employeeId = parseInt(subpath.split('/')[1]);
      return await handleGetEmployeeProjectBreakdown(event, employeeId);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Admin error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
