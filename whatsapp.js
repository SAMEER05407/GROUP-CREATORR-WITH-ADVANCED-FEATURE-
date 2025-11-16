import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';

const userSessions = new Map();

async function clearAuthSession(userId) {
  try {
    const sessionPath = `./.wwebjs_auth/session-${userId}`;
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`Auth session cleared for user ${userId}`);
    }
  } catch (error) {
    console.error(`Error clearing auth session for user ${userId}:`, error);
  }
}

async function startSock(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      qr: '',
      connected: false,
      client: null,
      isStarting: false
    });
  }

  const userSession = userSessions.get(userId);
  
  if (userSession.isStarting) return;
  userSession.isStarting = true;

  try {
    if (userSession.client) {
      try {
        await userSession.client.destroy();
      } catch (e) {
        console.log(`Cleanup error (ignorable):`, e.message);
      }
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    client.on('qr', (qr) => {
      qrcode.toDataURL(qr, (err, url) => {
        if (!err) {
          userSession.qr = url;
          console.log(`✅ New QR code generated for user ${userId}`);
        }
      });
    });

    client.on('ready', () => {
      userSession.connected = true;
      userSession.qr = '';
      userSession.isStarting = false;
      console.log(`✅ WhatsApp connected successfully for user ${userId}!`);
    });

    client.on('authenticated', () => {
      console.log(`🔐 Authentication successful for user ${userId}`);
    });

    client.on('auth_failure', (msg) => {
      console.log(`❌ Authentication failed for user ${userId}:`, msg);
      userSession.connected = false;
      userSession.qr = '';
      userSession.isStarting = false;
    });

    client.on('disconnected', async (reason) => {
      console.log(`📴 Client disconnected for user ${userId}:`, reason);
      userSession.connected = false;
      userSession.qr = '';
      userSession.isStarting = false;
      
      if (reason === 'LOGOUT' || reason === 'CONFLICT') {
        console.log(`🧹 Clearing session for user ${userId} due to logout/conflict`);
        await clearAuthSession(userId);
        userSession.client = null;
      } else {
        console.log(`🔄 Will retry connection for user ${userId} in 5s...`);
        setTimeout(() => startSock(userId), 5000);
      }
    });

    client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading for user ${userId}:`, percent, message);
    });

    userSession.client = client;
    userSession.isStarting = false;

    client.initialize().catch(err => {
      console.error(`❌ Error initializing client for ${userId}:`, err);
      userSession.isStarting = false;
      setTimeout(() => startSock(userId), 5000);
    });

    return client;

  } catch (error) {
    console.error(`❌ Error starting WhatsApp client for user ${userId}:`, error);
    userSession.isStarting = false;
    setTimeout(() => startSock(userId), 5000);
  }
}

async function restartConnection(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  console.log(`🔄 Force restarting WhatsApp connection for user ${userId}...`);
  
  let userSession = userSessions.get(userId);
  
  if (!userSession) {
    console.log(`📝 Creating new session for user ${userId}`);
    userSessions.set(userId, {
      qr: '',
      connected: false,
      client: null,
      isStarting: false
    });
    userSession = userSessions.get(userId);
  }
  
  if (userSession.client) {
    try {
      await userSession.client.destroy();
      console.log(`✅ Destroyed existing client for user ${userId}`);
    } catch (error) {
      console.log(`⚠️ Error destroying client (ignorable):`, error.message);
    }
  }
  
  userSession.client = null;
  userSession.connected = false;
  userSession.qr = '';
  userSession.isStarting = false;
  
  console.log(`🧹 Clearing old session files for user ${userId}...`);
  await clearAuthSession(userId);
  
  console.log(`✅ Session cleared for user ${userId}`);
  console.log(`⏳ Starting fresh connection in 3 seconds...`);
  
  setTimeout(() => {
    console.log(`🚀 Starting fresh WhatsApp session for user ${userId}`);
    startSock(userId);
  }, 3000);
}

export function getQR(req, res) {
  const userId = req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const userSession = userSessions.get(userId);
  if (!userSession) {
    startSock(userId);
    return res.json({ qr: "" });
  }

  res.json({ qr: userSession.qr || "" });
}

export function getStatus(req, res) {
  const userId = req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const userSession = userSessions.get(userId);
  if (!userSession) {
    return res.json({ connected: false, hasQR: false });
  }

  res.json({ 
    connected: userSession.connected, 
    hasQR: !!userSession.qr 
  });
}

export function getSock(userId) {
  if (!userId) return null;
  const userSession = userSessions.get(userId);
  return userSession && userSession.connected ? userSession.client : null;
}

export function getPairingCode(req, res) {
  const userId = req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  return res.json({ pairingCode: "" });
}

export function usePairingCode(req, res) {
  const userId = req.headers['user-id'] || req.body.userId;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  return res.status(400).json({ 
    error: 'Pairing code not supported with WhatsApp Web.js. Please use QR code method.' 
  });
}

export { restartConnection, startSock };
