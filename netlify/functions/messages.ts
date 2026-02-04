import type { Handler, HandlerEvent } from '@netlify/functions';
import { db } from '../../db';
import { adminEmployees, users, messages, sessions } from '../../db/schema';
import { eq, and, or, desc, inArray, sql } from 'drizzle-orm';
import { authenticate } from './utils/auth';
import { jsonResponse } from './utils/response';

function getSubpath(event: HandlerEvent): string {
  const path = event.path || '';
  const match = path.match(/\/messages\/?(.*)/);
  return match ? match[1] : '';
}

async function handleGetAdmins(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const admins = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(adminEmployees)
    .innerJoin(users, eq(adminEmployees.adminId, users.id))
    .where(eq(adminEmployees.employeeId, auth.user!.userId))
    .orderBy(desc(adminEmployees.createdAt));

  return jsonResponse(200, { admins }, auth.cookies);
}

async function handleGetMessages(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  // Check if user is admin
  const userRows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, auth.user!.userId))
    .limit(1);

  const isAdmin = userRows[0]?.isAdmin || false;

  // Get messages - if admin, get all messages for their employees; if employee, get their own messages
  let messageRows;
  if (isAdmin) {
    // Get messages from all linked employees
    const employeeIds = await db
      .select({ employeeId: adminEmployees.employeeId })
      .from(adminEmployees)
      .where(eq(adminEmployees.adminId, auth.user!.userId));

    const employeeIdList = employeeIds.map(e => e.employeeId);

    if (employeeIdList.length === 0) {
      // No employees linked, return empty array
      messageRows = [];
    } else {
      messageRows = await db
        .select({
          id: messages.id,
          sender_id: messages.senderId,
          sender_name: users.username,
          recipient_id: messages.recipientId,
          recipient_name: sql<string>`recipient_user.username`.as('recipient_name'),
          session_id: messages.sessionId,
          requested_clock_in: messages.requestedClockIn,
          requested_clock_out: messages.requestedClockOut,
          message: messages.message,
          status: messages.status,
          response_message: messages.responseMessage,
          created_at: messages.createdAt,
          updated_at: messages.updatedAt,
        })
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .leftJoin(sql`users AS recipient_user`, sql`messages.recipient_id = recipient_user.id`)
        .where(inArray(messages.senderId, employeeIdList))
        .orderBy(desc(messages.createdAt))
        .limit(100);
    }
  } else {
    // Get messages sent by this employee - include username
    messageRows = await db
      .select({
        id: messages.id,
        sender_id: messages.senderId,
        sender_name: users.username,
        recipient_id: messages.recipientId,
        recipient_name: sql<string>`recipient_user.username`.as('recipient_name'),
        session_id: messages.sessionId,
        requested_clock_in: messages.requestedClockIn,
        requested_clock_out: messages.requestedClockOut,
        message: messages.message,
        status: messages.status,
        response_message: messages.responseMessage,
        created_at: messages.createdAt,
        updated_at: messages.updatedAt,
      })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .leftJoin(sql`users AS recipient_user`, sql`messages.recipient_id = recipient_user.id`)
      .where(eq(messages.senderId, auth.user!.userId))
      .orderBy(desc(messages.createdAt))
      .limit(100);
  }

  return jsonResponse(200, { messages: messageRows }, auth.cookies);
}

async function handleSendMessage(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  const { sessionId, requestedClockIn, requestedClockOut, message, recipientId } = JSON.parse(
    event.body || '{}'
  );

  if (!sessionId || !requestedClockIn || !requestedClockOut) {
    return jsonResponse(
      400,
      { error: 'Session ID, requested clock in, and requested clock out are required' },
      auth.cookies
    );
  }

  // Verify session belongs to the user
  const sessionRows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (sessionRows.length === 0) {
    return jsonResponse(404, { error: 'Session not found' }, auth.cookies);
  }

  if (sessionRows[0].userId !== auth.user!.userId) {
    return jsonResponse(403, { error: 'Not authorized to request changes to this session' }, auth.cookies);
  }

  // Create the message
  const [newMessage] = await db
    .insert(messages)
    .values({
      senderId: auth.user!.userId,
      recipientId: recipientId || null,
      sessionId: sessionId,
      requestedClockIn: requestedClockIn,
      requestedClockOut: requestedClockOut,
      message: message || null,
      status: 'pending',
    })
    .returning();

  return jsonResponse(201, { message: 'Request sent successfully', data: newMessage }, auth.cookies);
}

async function handleRespondToMessage(event: HandlerEvent, messageId: number) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  // Check if user is admin
  const userRows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, auth.user!.userId))
    .limit(1);

  const isAdmin = userRows[0]?.isAdmin || false;
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Admin access required' }, auth.cookies);
  }

  const body = JSON.parse(event.body || '{}');
  const { status, message, responseMessage } = body;
  const responseMsg = message || responseMessage;

  if (!status || !['approved', 'rejected', 'denied'].includes(status)) {
    return jsonResponse(400, { error: 'Valid status (approved/rejected/denied) is required' }, auth.cookies);
  }

  // Normalize 'denied' to 'rejected' for consistency
  const finalStatus = status === 'denied' ? 'rejected' : status;

  // Get the message
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (messageRows.length === 0) {
    return jsonResponse(404, { error: 'Message not found' }, auth.cookies);
  }

  const messageRecord = messageRows[0];

  // Verify the sender is linked to this admin
  const linkedRows = await db
    .select({ id: adminEmployees.id })
    .from(adminEmployees)
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(adminEmployees.employeeId, messageRecord.senderId)
      )
    )
    .limit(1);

  if (linkedRows.length === 0) {
    return jsonResponse(403, { error: 'Not authorized to respond to this message' }, auth.cookies);
  }

  // If approved, update the session
  if (finalStatus === 'approved' && messageRecord.sessionId) {
    // Calculate new duration
    const clockIn = new Date(messageRecord.requestedClockIn!);
    const clockOut = new Date(messageRecord.requestedClockOut!);
    const duration = clockOut.getTime() - clockIn.getTime();

    await db
      .update(sessions)
      .set({
        clockIn: messageRecord.requestedClockIn!,
        clockOut: messageRecord.requestedClockOut!,
        duration: duration,
      })
      .where(eq(sessions.id, messageRecord.sessionId));
  }

  // Update the message
  await db
    .update(messages)
    .set({
      status: finalStatus,
      responseMessage: responseMsg || null,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, messageId));

  return jsonResponse(
    200,
    { message: `Request ${finalStatus} successfully` },
    auth.cookies
  );
}

async function handleGetPendingCount(event: HandlerEvent) {
  const auth = await authenticate(event);
  if (auth.error) return jsonResponse(401, { error: auth.error }, auth.cookies);

  // Check if user is admin
  const userRows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, auth.user!.userId))
    .limit(1);

  const isAdmin = userRows[0]?.isAdmin || false;

  if (!isAdmin) {
    return jsonResponse(200, { count: 0 }, auth.cookies);
  }

  // Count pending messages from linked employees
  const countRows = await db
    .select()
    .from(messages)
    .innerJoin(adminEmployees, eq(messages.senderId, adminEmployees.employeeId))
    .where(
      and(
        eq(adminEmployees.adminId, auth.user!.userId),
        eq(messages.status, 'pending')
      )
    );

  return jsonResponse(200, { count: countRows.length }, auth.cookies);
}

export const handler: Handler = async (event) => {
  const subpath = getSubpath(event);
  const method = event.httpMethod;

  try {
    // GET /messages/admins
    if (method === 'GET' && subpath === 'admins') {
      return await handleGetAdmins(event);
    }

    // GET /messages/pending-count
    if (method === 'GET' && subpath === 'pending-count') {
      return await handleGetPendingCount(event);
    }

    // GET /messages
    if (method === 'GET' && subpath === '') {
      return await handleGetMessages(event);
    }

    // POST /messages
    if (method === 'POST' && subpath === '') {
      return await handleSendMessage(event);
    }

    // POST /messages/:id/respond
    if (method === 'POST' && subpath.match(/^\d+\/respond$/)) {
      const messageId = parseInt(subpath.split('/')[0]);
      return await handleRespondToMessage(event, messageId);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Messages error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
