const express = require('express');
const { getDb, generateEmployeeCode } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);

    // Create default settings if not exist
    if (!settings) {
      let employeeCode;
      let attempts = 0;
      while (attempts < 10) {
        employeeCode = generateEmployeeCode();
        const existing = db.prepare('SELECT user_id FROM user_settings WHERE employee_code = ?').get(employeeCode);
        if (!existing) break;
        attempts++;
      }

      db.prepare(`
        INSERT INTO user_settings (user_id, hourly_rate, text_size, employee_code)
        VALUES (?, 0, 'medium', ?)
      `).run(req.user.userId, employeeCode);

      settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);
    }

    // Auto-generate employee code if missing (for pre-existing users)
    if (!settings.employee_code) {
      let employeeCode;
      let attempts = 0;
      while (attempts < 10) {
        employeeCode = generateEmployeeCode();
        const existing = db.prepare('SELECT user_id FROM user_settings WHERE employee_code = ?').get(employeeCode);
        if (!existing) break;
        attempts++;
      }
      db.prepare('UPDATE user_settings SET employee_code = ? WHERE user_id = ?').run(employeeCode, req.user.userId);
      settings.employee_code = employeeCode;
    }

    res.json({
      settings: {
        hourlyRate: settings.hourly_rate,
        textSize: settings.text_size,
        employeeCode: settings.employee_code
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update settings
router.put('/', (req, res) => {
  try {
    const db = getDb();
    const { hourlyRate, textSize } = req.body;

    // Validate text size
    const validSizes = ['small', 'medium', 'large'];
    if (textSize && !validSizes.includes(textSize)) {
      return res.status(400).json({ error: 'Invalid text size' });
    }

    // Validate hourly rate
    if (hourlyRate !== undefined && (typeof hourlyRate !== 'number' || hourlyRate < 0)) {
      return res.status(400).json({ error: 'Invalid hourly rate' });
    }

    // Check if settings exist
    const existing = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);

    if (!existing) {
      // Create settings
      db.prepare(`
        INSERT INTO user_settings (user_id, hourly_rate, text_size)
        VALUES (?, ?, ?)
      `).run(
        req.user.userId,
        hourlyRate !== undefined ? hourlyRate : 0,
        textSize || 'medium'
      );
    } else {
      // Update settings
      const updates = [];
      const params = [];

      if (hourlyRate !== undefined) {
        updates.push('hourly_rate = ?');
        params.push(hourlyRate);
      }
      if (textSize) {
        updates.push('text_size = ?');
        params.push(textSize);
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        params.push(req.user.userId);

        db.prepare(`
          UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?
        `).run(...params);
      }
    }

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);

    res.json({
      message: 'Settings updated',
      settings: {
        hourlyRate: settings.hourly_rate,
        textSize: settings.text_size,
        employeeCode: settings.employee_code
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
