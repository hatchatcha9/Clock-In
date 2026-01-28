const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const {
  sendEmail,
  generateDailyReportEmail,
  generateWeeklyReportEmail,
  formatDate
} = require('../utils/emailService');

const router = express.Router();

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

// Share daily report via email
router.post('/daily', async (req, res) => {
  try {
    const db = getDb();
    const { email, date } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get target date
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get user info
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);

    // Get sessions for the day
    const sessions = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in < ?
      ORDER BY s.clock_in ASC
    `).all(req.user.userId, targetDate.toISOString(), nextDay.toISOString());

    // Calculate totals
    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    // Get hourly rate
    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    // Generate email HTML
    const html = generateDailyReportEmail({
      username: user.username,
      date: targetDate.toISOString(),
      sessions,
      totalMs,
      earnings,
      hourlyRate
    });

    // Send email
    await sendEmail({
      to: email,
      subject: `Daily Time Report - ${formatDate(targetDate.toISOString())}`,
      html
    });

    res.json({ message: 'Daily report sent successfully', sentTo: email });
  } catch (error) {
    console.error('Share daily report error:', error);
    res.status(500).json({ error: error.message || 'Failed to send daily report' });
  }
});

// Share weekly report via email
router.post('/weekly', async (req, res) => {
  try {
    const db = getDb();
    const { email, date } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get week range
    const targetDate = date ? new Date(date) : new Date();
    const weekStart = getWeekStart(targetDate);
    const weekEnd = getWeekEnd(targetDate);

    // Get user info
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);

    // Get sessions for the week
    const sessions = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in <= ?
      ORDER BY s.clock_in ASC
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    // Calculate totals
    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    // Get hourly rate
    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    // Calculate daily breakdown
    const dailyStats = [0, 0, 0, 0, 0, 0, 0];
    sessions.forEach(session => {
      const day = new Date(session.clock_in).getDay();
      dailyStats[day] += session.duration;
    });

    // Get project breakdown
    const projectBreakdown = db.prepare(`
      SELECT
        COALESCE(p.name, 'No Project') as name,
        SUM(s.duration) as total_ms,
        COUNT(s.id) as session_count
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in <= ?
      GROUP BY COALESCE(p.name, 'No Project')
      ORDER BY total_ms DESC
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    // Generate email HTML
    const html = generateWeeklyReportEmail({
      username: user.username,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      sessions,
      totalMs,
      earnings,
      hourlyRate,
      dailyStats,
      projectBreakdown
    });

    // Send email
    await sendEmail({
      to: email,
      subject: `Weekly Time Report - Week of ${formatDate(weekStart.toISOString())}`,
      html
    });

    res.json({ message: 'Weekly report sent successfully', sentTo: email });
  } catch (error) {
    console.error('Share weekly report error:', error);
    res.status(500).json({ error: error.message || 'Failed to send weekly report' });
  }
});

// Preview daily report (returns HTML without sending)
router.get('/preview/daily', async (req, res) => {
  try {
    const db = getDb();
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);

    const sessions = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in < ?
      ORDER BY s.clock_in ASC
    `).all(req.user.userId, targetDate.toISOString(), nextDay.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    const html = generateDailyReportEmail({
      username: user.username,
      date: targetDate.toISOString(),
      sessions,
      totalMs,
      earnings,
      hourlyRate
    });

    res.send(html);
  } catch (error) {
    console.error('Preview daily report error:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// Preview weekly report (returns HTML without sending)
router.get('/preview/weekly', async (req, res) => {
  try {
    const db = getDb();
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const weekStart = getWeekStart(targetDate);
    const weekEnd = getWeekEnd(targetDate);

    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);

    const sessions = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in <= ?
      ORDER BY s.clock_in ASC
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);

    const settings = db.prepare('SELECT hourly_rate FROM user_settings WHERE user_id = ?').get(req.user.userId);
    const hourlyRate = settings?.hourly_rate || 0;
    const earnings = (totalMs / (1000 * 60 * 60)) * hourlyRate;

    const dailyStats = [0, 0, 0, 0, 0, 0, 0];
    sessions.forEach(session => {
      const day = new Date(session.clock_in).getDay();
      dailyStats[day] += session.duration;
    });

    const projectBreakdown = db.prepare(`
      SELECT
        COALESCE(p.name, 'No Project') as name,
        SUM(s.duration) as total_ms,
        COUNT(s.id) as session_count
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.user_id = ? AND s.clock_in >= ? AND s.clock_in <= ?
      GROUP BY COALESCE(p.name, 'No Project')
      ORDER BY total_ms DESC
    `).all(req.user.userId, weekStart.toISOString(), weekEnd.toISOString());

    const html = generateWeeklyReportEmail({
      username: user.username,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      sessions,
      totalMs,
      earnings,
      hourlyRate,
      dailyStats,
      projectBreakdown
    });

    res.send(html);
  } catch (error) {
    console.error('Preview weekly report error:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

module.exports = router;
