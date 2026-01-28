const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Helper functions
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(date) {
  const start = getWeekStart(date);
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000);
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

// Get today's summary
router.get('/today', (req, res) => {
  try {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND clock_in >= ? AND clock_in < ?
    `).all(req.user.userId, today.toISOString(), tomorrow.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    res.json({
      date: today.toISOString(),
      sessionCount: sessions.length,
      totalMs,
      earnings
    });
  } catch (error) {
    console.error('Get today report error:', error);
    res.status(500).json({ error: 'Failed to get today report' });
  }
});

// Get weekly stats
router.get('/weekly', (req, res) => {
  try {
    const db = getDb();
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const weekStart = getWeekStart(targetDate);
    const weekEnd = getWeekEnd(targetDate);

    const sessions = db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND clock_in >= ? AND clock_in <= ?
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    // Calculate daily breakdown
    const dailyStats = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    sessions.forEach(session => {
      const day = new Date(session.clock_in).getDay();
      dailyStats[day] += session.duration;
    });

    res.json({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      sessionCount: sessions.length,
      totalMs,
      earnings,
      dailyStats
    });
  } catch (error) {
    console.error('Get weekly report error:', error);
    res.status(500).json({ error: 'Failed to get weekly report' });
  }
});

// Get monthly stats
router.get('/monthly', (req, res) => {
  try {
    const db = getDb();
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const monthStart = getMonthStart(targetDate);
    const monthEnd = getMonthEnd(targetDate);

    const sessions = db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND clock_in >= ? AND clock_in <= ?
    `).all(req.user.userId, monthStart.toISOString(), monthEnd.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    res.json({
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      sessionCount: sessions.length,
      totalMs,
      earnings
    });
  } catch (error) {
    console.error('Get monthly report error:', error);
    res.status(500).json({ error: 'Failed to get monthly report' });
  }
});

// Get project breakdown
router.get('/projects', (req, res) => {
  try {
    const db = getDb();
    const { start, end } = req.query;

    let query = `
      SELECT
        p.id,
        p.name,
        COALESCE(SUM(s.duration), 0) as total_ms,
        COUNT(s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON p.id = s.project_id AND s.user_id = ?
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

    query += `
      WHERE p.user_id = ?
      GROUP BY p.id, p.name
      ORDER BY total_ms DESC
    `;
    params.push(req.user.userId);

    const projects = db.prepare(query).all(...params);

    // Also get "No Project" sessions
    let noProjectQuery = `
      SELECT
        COALESCE(SUM(duration), 0) as total_ms,
        COUNT(id) as session_count
      FROM sessions
      WHERE user_id = ? AND project_id IS NULL
    `;
    const noProjectParams = [req.user.userId];

    if (start) {
      noProjectQuery += ' AND clock_in >= ?';
      noProjectParams.push(start);
    }
    if (end) {
      noProjectQuery += ' AND clock_in <= ?';
      noProjectParams.push(end);
    }

    const noProject = db.prepare(noProjectQuery).get(...noProjectParams);

    res.json({
      projects,
      noProject: {
        name: 'No Project',
        total_ms: noProject.total_ms,
        session_count: noProject.session_count
      }
    });
  } catch (error) {
    console.error('Get project breakdown error:', error);
    res.status(500).json({ error: 'Failed to get project breakdown' });
  }
});

// Get past weekly reports
router.get('/past-weeks', (req, res) => {
  try {
    const db = getDb();
    const reports = db.prepare(`
      SELECT * FROM weekly_reports
      WHERE user_id = ?
      ORDER BY week_start DESC
      LIMIT 12
    `).all(req.user.userId);

    res.json({ reports });
  } catch (error) {
    console.error('Get past weekly reports error:', error);
    res.status(500).json({ error: 'Failed to get past weekly reports' });
  }
});

// Generate/store weekly report
router.post('/generate-weekly', (req, res) => {
  try {
    const db = getDb();
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    const weekStart = getWeekStart(targetDate);
    const weekEnd = getWeekEnd(targetDate);
    const weekId = weekStart.toISOString().split('T')[0];

    // Check if report already exists
    const existing = db.prepare(
      'SELECT * FROM weekly_reports WHERE user_id = ? AND week_id = ?'
    ).get(req.user.userId, weekId);

    if (existing) {
      return res.json({ message: 'Report already exists', report: existing });
    }

    // Calculate stats
    const sessions = db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND clock_in >= ? AND clock_in <= ?
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    // Store report
    const stmt = db.prepare(`
      INSERT INTO weekly_reports (user_id, week_id, week_start, week_end, total_ms, session_count, earnings)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      req.user.userId,
      weekId,
      weekStart.toISOString(),
      weekEnd.toISOString(),
      totalMs,
      sessions.length,
      earnings
    );

    const report = db.prepare('SELECT * FROM weekly_reports WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({ message: 'Report generated', report });
  } catch (error) {
    console.error('Generate weekly report error:', error);
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
});

module.exports = router;
