import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { projects } from '../../db/schema';
import { eq, and, asc, ne } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse } from './utils/response';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/projects\/?(.*)/);
  return match ? match[1] : '';
}

async function handleGetProjects(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const projectList = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, auth.user!.userId))
    .orderBy(asc(projects.name));

  return jsonResponse(200, { projects: projectList }, auth.cookies);
}

async function handleCreateProject(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { name } = JSON.parse(event.body || '{}');
  if (!name || !name.trim()) {
    return jsonResponse(400, { error: 'Project name is required' }, auth.cookies);
  }

  const trimmedName = name.trim();

  // Check for duplicate
  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, auth.user!.userId), eq(projects.name, trimmedName)))
    .limit(1);

  if (existing.length > 0) {
    return jsonResponse(409, { error: 'Project already exists' }, auth.cookies);
  }

  const [project] = await db
    .insert(projects)
    .values({ userId: auth.user!.userId, name: trimmedName })
    .returning();

  return jsonResponse(201, { message: 'Project created', project }, auth.cookies);
}

async function handleUpdateProject(event: HandlerEvent, id: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { name } = JSON.parse(event.body || '{}');
  if (!name || !name.trim()) {
    return jsonResponse(400, { error: 'Project name is required' }, auth.cookies);
  }

  // Verify ownership
  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    return jsonResponse(404, { error: 'Project not found' }, auth.cookies);
  }

  const trimmedName = name.trim();

  // Check for duplicate name (excluding current)
  const duplicate = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.userId, auth.user!.userId),
        eq(projects.name, trimmedName),
        ne(projects.id, id)
      )
    )
    .limit(1);

  if (duplicate.length > 0) {
    return jsonResponse(409, { error: 'Project name already exists' }, auth.cookies);
  }

  const [updated] = await db
    .update(projects)
    .set({ name: trimmedName })
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user!.userId)))
    .returning();

  return jsonResponse(200, { message: 'Project updated', project: updated }, auth.cookies);
}

async function handleDeleteProject(event: HandlerEvent, id: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  // Verify ownership
  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    return jsonResponse(404, { error: 'Project not found' }, auth.cookies);
  }

  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user!.userId)));

  return jsonResponse(200, { message: 'Project deleted' }, auth.cookies);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;
  const id = subpath ? parseInt(subpath) : NaN;

  try {
    if (method === 'GET' && !subpath) return await handleGetProjects(event);
    if (method === 'POST' && !subpath) return await handleCreateProject(event);
    if (method === 'PUT' && !isNaN(id)) return await handleUpdateProject(event, id);
    if (method === 'DELETE' && !isNaN(id)) return await handleDeleteProject(event, id);

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Projects error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
