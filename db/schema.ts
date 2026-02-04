import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  real,
  uniqueIndex,
  index,
  bigint,
} from 'drizzle-orm/pg-core';

// Users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 255 }).unique().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// User settings table
export const userSettings = pgTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hourlyRate: real('hourly_rate').default(0),
  textSize: varchar('text_size', { length: 20 }).default('medium'),
  employeeCode: varchar('employee_code', { length: 8 }).unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Projects table
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_user_id_name_unique').on(table.userId, table.name),
    index('idx_projects_user_id').on(table.userId),
  ]
);

// Sessions table (completed clock in/out sessions)
export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clockIn: text('clock_in').notNull(),
    clockOut: text('clock_out').notNull(),
    duration: bigint('duration', { mode: 'number' }).notNull(),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_clock_in').on(table.clockIn),
  ]
);

// Active sessions table (currently clocked in)
export const activeSessions = pgTable('active_sessions', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  clockIn: text('clock_in').notNull(),
  projectId: integer('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  breakTime: bigint('break_time', { mode: 'number' }).default(0),
  isOnBreak: boolean('is_on_break').default(false),
  breakStart: text('break_start'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Weekly reports table
export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekId: varchar('week_id', { length: 20 }).notNull(),
    weekStart: text('week_start').notNull(),
    weekEnd: text('week_end').notNull(),
    totalMs: bigint('total_ms', { mode: 'number' }).notNull(),
    sessionCount: integer('session_count').notNull(),
    earnings: real('earnings').notNull(),
    generatedAt: timestamp('generated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('weekly_reports_user_id_week_id_unique').on(
      table.userId,
      table.weekId
    ),
    index('idx_weekly_reports_user_id').on(table.userId),
  ]
);

// Refresh tokens table
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').unique().notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_token').on(table.token),
  ]
);

// Admin-employee relationships table
export const adminEmployees = pgTable(
  'admin_employees',
  {
    id: serial('id').primaryKey(),
    adminId: integer('admin_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_employees_admin_id_employee_id_unique').on(
      table.adminId,
      table.employeeId
    ),
    index('idx_admin_employees_admin_id').on(table.adminId),
    index('idx_admin_employees_employee_id').on(table.employeeId),
  ]
);

// Password reset tokens table
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').unique().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    used: boolean('used').default(false),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_password_reset_tokens_token').on(table.token),
    index('idx_password_reset_tokens_user_id').on(table.userId),
  ]
);

// Messages table (hour change requests)
export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),
    senderId: integer('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: integer('recipient_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    sessionId: integer('session_id').references(() => sessions.id, {
      onDelete: 'cascade',
    }),
    requestedClockIn: text('requested_clock_in'),
    requestedClockOut: text('requested_clock_out'),
    message: text('message'),
    status: varchar('status', { length: 20 }).default('pending'),
    responseMessage: text('response_message'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_messages_sender_id').on(table.senderId),
    index('idx_messages_recipient_id').on(table.recipientId),
    index('idx_messages_status').on(table.status),
    index('idx_messages_parent_id').on(table.parentId),
  ]
);
