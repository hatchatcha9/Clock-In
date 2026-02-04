require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

// Import database initialization
const { initDatabase } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const projectsRoutes = require('./routes/projects');
const settingsRoutes = require('./routes/settings');
const reportsRoutes = require('./routes/reports');
const shareRoutes = require('./routes/share');
const adminRoutes = require('./routes/admin');
const messagesRoutes = require('./routes/messages');

// Import utilities
const { cleanExpiredTokens } = require('./utils/tokenUtils');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messagesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Initialize database and start server
async function start() {
  try {
    await initDatabase();
    console.log('Database initialized');

    // Clean expired tokens periodically (every hour)
    setInterval(() => {
      cleanExpiredTokens();
    }, 60 * 60 * 1000);

    // Initial cleanup
    cleanExpiredTokens();

    // Start server
    app.listen(PORT, () => {
      console.log(`Clock In server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
