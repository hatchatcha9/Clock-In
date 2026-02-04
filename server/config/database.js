const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'clockin.db');

let db = null;
let SQL = null;

// Initialize sql.js and load/create database
async function initDatabase() {
  if (db) return db;

  SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize schema
  db.run(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- User settings table
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      hourly_rate REAL DEFAULT 0,
      text_size TEXT DEFAULT 'medium',
      employee_code TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Admin-Employee junction table
    CREATE TABLE IF NOT EXISTS admin_employees (
      admin_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (admin_id, employee_id),
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );

    -- Sessions table (completed clock in/out sessions)
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      clock_in TEXT NOT NULL,
      clock_out TEXT NOT NULL,
      duration INTEGER NOT NULL,
      project_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    -- Active sessions table (currently clocked in)
    CREATE TABLE IF NOT EXISTS active_sessions (
      user_id INTEGER PRIMARY KEY,
      clock_in TEXT NOT NULL,
      project_id INTEGER,
      break_time INTEGER DEFAULT 0,
      is_on_break INTEGER DEFAULT 0,
      break_start TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    -- Weekly reports table
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      week_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      total_ms INTEGER NOT NULL,
      session_count INTEGER NOT NULL,
      earnings REAL NOT NULL,
      generated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, week_id)
    );

    -- Refresh tokens table
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Messages table (hour change requests / message board)
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'hour_change_request',
      status TEXT NOT NULL DEFAULT 'pending',
      session_id INTEGER,
      requested_clock_in TEXT,
      requested_clock_out TEXT,
      message TEXT,
      parent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_clock_in ON sessions(clock_in);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_weekly_reports_user_id ON weekly_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
  `);

  // Run migrations for existing databases
  runMigrations();

  // Save after schema creation
  saveDatabase();

  return db;
}

// Generate a unique 8-char alphanumeric employee code
function generateEmployeeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Run schema migrations for existing databases
function runMigrations() {
  // Add is_admin column to users if missing
  try {
    db.run("SELECT is_admin FROM users LIMIT 1");
  } catch (e) {
    db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  }

  // Add employee_code column to user_settings if missing
  try {
    db.run("SELECT employee_code FROM user_settings LIMIT 1");
  } catch (e) {
    db.run("ALTER TABLE user_settings ADD COLUMN employee_code TEXT");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_employee_code ON user_settings(employee_code)");
  }

  // Create admin_employees table if missing
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_employees (
      admin_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (admin_id, employee_id),
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create messages table if missing
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'hour_change_request',
      status TEXT NOT NULL DEFAULT 'pending',
      session_id INTEGER,
      requested_clock_in TEXT,
      requested_clock_out TEXT,
      message TEXT,
      parent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id)");

  // Generate employee codes for existing users that don't have one
  const wrapper = new DatabaseWrapper();
  const usersWithoutCode = wrapper.prepare(
    "SELECT us.user_id FROM user_settings us WHERE us.employee_code IS NULL"
  ).all();

  for (const row of usersWithoutCode) {
    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = generateEmployeeCode();
      const existing = wrapper.prepare(
        "SELECT user_id FROM user_settings WHERE employee_code = ?"
      ).get(code);
      if (!existing) break;
      attempts++;
    }
    wrapper.prepare(
      "UPDATE user_settings SET employee_code = ? WHERE user_id = ?"
    ).run(code, row.user_id);
  }
}

// Save database to file
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Wrapper class to provide better-sqlite3-like API
class DatabaseWrapper {
  prepare(sql) {
    return new StatementWrapper(sql);
  }

  exec(sql) {
    db.run(sql);
    saveDatabase();
  }

  pragma(pragma) {
    db.run(`PRAGMA ${pragma}`);
  }
}

class StatementWrapper {
  constructor(sql) {
    this.sql = sql;
  }

  run(...params) {
    db.run(this.sql, params);
    saveDatabase();

    // Get last insert rowid and changes
    const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] || 0;
    const changes = db.getRowsModified();

    return { lastInsertRowid: lastId, changes };
  }

  get(...params) {
    const stmt = db.prepare(this.sql);
    stmt.bind(params);

    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      stmt.free();

      const row = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });
      return row;
    }

    stmt.free();
    return undefined;
  }

  all(...params) {
    const results = [];
    const stmt = db.prepare(this.sql);
    stmt.bind(params);

    const columns = stmt.getColumnNames();
    while (stmt.step()) {
      const values = stmt.get();
      const row = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });
      results.push(row);
    }

    stmt.free();
    return results;
  }
}

// Export initialization function and wrapper
module.exports = {
  initDatabase,
  getDb: () => new DatabaseWrapper(),
  saveDatabase,
  generateEmployeeCode
};
