import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as auth from '../auth.js';
import * as whatsapp from '../whatsapp.js';
import * as groupManager from '../groupManager.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
app.get('/api/pairing-code', whatsapp.getPairingCode);
app.post('/api/use-pairing-code', whatsapp.usePairingCode);
app.get('/api/status', whatsapp.getStatus);
app.post('/api/restart-whatsapp', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || req.body.userId;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID is required' 
      });
    }

    console.log(`📱 Restart request received for user: ${userId}`);

    // Call restart function
    await whatsapp.restartConnection(userId);

    console.log(`✅ Restart initiated successfully for user: ${userId}`);

    return res.status(200).json({ 
      success: true,
      message: 'WhatsApp connection restart initiated successfully'
    });

  } catch (error) {
    console.error(`❌ Restart error for user ${req.body.userId}:`, error);

    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to restart WhatsApp connection'
    });
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