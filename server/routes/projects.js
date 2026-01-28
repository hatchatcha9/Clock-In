const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get all projects
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const projects = db.prepare(`
      SELECT * FROM projects WHERE user_id = ? ORDER BY name ASC
    `).all(req.user.userId);

    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

// Create project
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const trimmedName = name.trim();

    // Check for duplicate
    const existing = db.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND name = ?'
    ).get(req.user.userId, trimmedName);

    if (existing) {
      return res.status(409).json({ error: 'Project already exists' });
    }

    const stmt = db.prepare('INSERT INTO projects (user_id, name) VALUES (?, ?)');
    const result = stmt.run(req.user.userId, trimmedName);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({ message: 'Project created', project });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    // Verify ownership
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const trimmedName = name.trim();

    // Check for duplicate (excluding current project)
    const existing = db.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND name = ? AND id != ?'
    ).get(req.user.userId, trimmedName, id);

    if (existing) {
      return res.status(409).json({ error: 'Project name already exists' });
    }

    db.prepare('UPDATE projects SET name = ? WHERE id = ? AND user_id = ?').run(trimmedName, id, req.user.userId);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    res.json({ message: 'Project updated', project: updated });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    // Verify ownership
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Sessions with this project will have project_id set to NULL due to ON DELETE SET NULL
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, req.user.userId);

    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
