const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get all sessions (with optional date filtering)
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { start, end, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ?
    `;
    const params = [req.user.userId];

    if (start) {
      query += ' AND s.clock_in >= ?';
      params.push(start);
    }
    if (end) {
      query += ' AND s.clock_in <= ?';
      params.push(end);
    }

    query += ' ORDER BY s.clock_in DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const sessions = db.prepare(query).all(...params);

    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Get active session
router.get('/active', (req, res) => {
  try {
    const db = getDb();
    const active = db.prepare(`
      SELECT a.*, p.name as project_name
      FROM active_sessions a
      LEFT JOIN projects p ON a.project_id = p.id
      WHERE a.user_id = ?
    `).get(req.user.userId);

    res.json({ active: active || null });
  } catch (error) {
    console.error('Get active session error:', error);
    res.status(500).json({ error: 'Failed to get active session' });
  }
});

// Clock in
router.post('/clock-in', (req, res) => {
  try {
    const db = getDb();
    const { projectId } = req.body;

    // Check if already clocked in
    const existing = db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(req.user.userId);
    if (existing) {
      return res.status(400).json({ error: 'Already clocked in' });
    }

    const clockIn = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO active_sessions (user_id, clock_in, project_id, break_time, is_on_break)
      VALUES (?, ?, ?, 0, 0)
    `);
    stmt.run(req.user.userId, clockIn, projectId || null);

    const active = db.prepare(`
      SELECT a.*, p.name as project_name
      FROM active_sessions a
      LEFT JOIN projects p ON a.project_id = p.id
      WHERE a.user_id = ?
    `).get(req.user.userId);

    res.status(201).json({ message: 'Clocked in', active });
  } catch (error) {
    console.error('Clock in error:', error);
    res.status(500).json({ error: 'Failed to clock in' });
  }
});

// Clock out
router.post('/clock-out', (req, res) => {
  try {
    const db = getDb();
    const { notes } = req.body;

    const active = db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(req.user.userId);
    if (!active) {
      return res.status(400).json({ error: 'Not clocked in' });
    }

    const clockOut = new Date();
    const clockIn = new Date(active.clock_in);

    // Calculate total break time (including current break if on one)
    let totalBreakTime = active.break_time || 0;
    if (active.is_on_break && active.break_start) {
      totalBreakTime += clockOut.getTime() - new Date(active.break_start).getTime();
    }

    const duration = clockOut.getTime() - clockIn.getTime() - totalBreakTime;

    // Create session record
    const insertStmt = db.prepare(`
      INSERT INTO sessions (user_id, clock_in, clock_out, duration, project_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = insertStmt.run(
      req.user.userId,
      active.clock_in,
      clockOut.toISOString(),
      duration,
      active.project_id,
      notes || null
    );

    // Remove active session
    db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(req.user.userId);

    // Fetch the created session
    const session = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.id = ?
    `).get(result.lastInsertRowid);

    res.json({ message: 'Clocked out', session });
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({ error: 'Failed to clock out' });
  }
});

// Toggle break
router.post('/break', (req, res) => {
  try {
    const db = getDb();
    const active = db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(req.user.userId);
    if (!active) {
      return res.status(400).json({ error: 'Not clocked in' });
    }

    if (active.is_on_break) {
      // End break
      const breakEnd = new Date();
      const breakStart = new Date(active.break_start);
      const breakDuration = breakEnd.getTime() - breakStart.getTime();
      const newBreakTime = (active.break_time || 0) + breakDuration;

      db.prepare(`
        UPDATE active_sessions
        SET is_on_break = 0, break_start = NULL, break_time = ?
        WHERE user_id = ?
      `).run(newBreakTime, req.user.userId);

      res.json({ message: 'Break ended', isOnBreak: false, breakTime: newBreakTime });
    } else {
      // Start break
      const breakStart = new Date().toISOString();

      db.prepare(`
        UPDATE active_sessions
        SET is_on_break = 1, break_start = ?
        WHERE user_id = ?
      `).run(breakStart, req.user.userId);

      res.json({ message: 'Break started', isOnBreak: true, breakStart });
    }
  } catch (error) {
    console.error('Toggle break error:', error);
    res.status(500).json({ error: 'Failed to toggle break' });
  }
});

// Update session
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { clockIn, clockOut, projectId, notes } = req.body;

    // Verify ownership
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const newClockIn = clockIn ? new Date(clockIn) : new Date(session.clock_in);
    const newClockOut = clockOut ? new Date(clockOut) : new Date(session.clock_out);
    const duration = newClockOut.getTime() - newClockIn.getTime();

    if (duration <= 0) {
      return res.status(400).json({ error: 'Clock out must be after clock in' });
    }

    db.prepare(`
      UPDATE sessions
      SET clock_in = ?, clock_out = ?, duration = ?, project_id = ?, notes = ?
      WHERE id = ? AND user_id = ?
    `).run(
      newClockIn.toISOString(),
      newClockOut.toISOString(),
      duration,
      projectId !== undefined ? projectId : session.project_id,
      notes !== undefined ? notes : session.notes,
      id,
      req.user.userId
    );

    const updated = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.id = ?
    `).get(id);

    res.json({ message: 'Session updated', session: updated });
  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Delete session
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    // Verify ownership
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, req.user.userId);

    res.json({ message: 'Session deleted' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Create manual session
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { clockIn, clockOut, projectId, notes } = req.body;

    if (!clockIn || !clockOut) {
      return res.status(400).json({ error: 'Clock in and clock out times are required' });
    }

    const clockInDate = new Date(clockIn);
    const clockOutDate = new Date(clockOut);
    const duration = clockOutDate.getTime() - clockInDate.getTime();

    if (duration <= 0) {
      return res.status(400).json({ error: 'Clock out must be after clock in' });
    }

    const stmt = db.prepare(`
      INSERT INTO sessions (user_id, clock_in, clock_out, duration, project_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      req.user.userId,
      clockInDate.toISOString(),
      clockOutDate.toISOString(),
      duration,
      projectId || null,
      notes || null
    );

    const session = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ message: 'Session created', session });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

module.exports = router;
