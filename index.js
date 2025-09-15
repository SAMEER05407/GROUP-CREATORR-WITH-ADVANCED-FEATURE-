const express = require('express');
const path = require('path');
const app = express();
const auth = require('../auth');
const whatsapp = require('../whatsapp');
const groupManager = require('../groupManager');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Root route for server status
app.get('/', (req, res) => {
  res.status(200).send('✅ Server is live');
});

// Health check endpoint for UptimeRobot monitoring
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Authentication routes
app.post('/api/login', auth.login);

// WhatsApp routes
app.get('/api/qr', whatsapp.getQR);
app.get('/api/status', whatsapp.getStatus);
app.post('/api/restart-whatsapp', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    await whatsapp.restartConnection(userId);
    res.json({ success: true, message: 'WhatsApp connection restarted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart WhatsApp connection' });
  }
});

// Group management
app.post('/api/create-groups', groupManager.createGroups);

// Admin routes
app.get('/api/admin/users', auth.getUsers);
app.post('/api/admin/add-user', auth.addUser);
app.post('/api/admin/remove-user', auth.removeUser);

// Notice routes
app.get('/api/notice', auth.getNotice);
app.post('/api/admin/update-notice', auth.updateNotice);

const PORT = process.env.PORT || 5000;

// Ensure required directories exist
const fs = require('fs');
const authInfoDir = './auth_info';
const sessionsDir = './sessions';

if (!fs.existsSync(authInfoDir)) {
  fs.mkdirSync(authInfoDir, { recursive: true });
}

if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Server URL: http://0.0.0.0:${PORT}`);
});
