
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');

// Store user sessions
const userSessions = new Map();

// User session structure: { qr, connected, sock, isStarting }

// Function to completely clear session files for a specific user
async function clearAuthSession(userId) {
  try {
    const sessionPath = `./sessions/${userId}`;
    if (fs.existsSync(sessionPath)) {
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        if (file !== '.gitkeep') {
          fs.unlinkSync(path.join(sessionPath, file));
        }
      }
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

  // Get or create user session
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      qr: '',
      connected: false,
      sock: null,
      isStarting: false
    });
  }

  const userSession = userSessions.get(userId);
  
  if (userSession.isStarting) return;
  userSession.isStarting = true;
  
  try {
    // Create user-specific session directory
    const sessionPath = `./sessions/${userId}`;
    if (!fs.existsSync('./sessions')) {
      fs.mkdirSync('./sessions');
    }
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const sock = makeWASocket({ 
      auth: state,
      printQRInTerminal: false,
      browser: ['WhatsApp Group Bot', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      defaultQueryTimeoutMs: 90000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 3,
      msgRetryCounterMap: {},
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => false,
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      emitOwnEvents: false
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        require('qrcode').toDataURL(qr, (err, url) => {
          if (!err) {
            userSession.qr = url;
            console.log(`New QR code generated for user ${userId}`);
          }
        });
      }
      
      if (connection === 'close') {
        userSession.connected = false;
        
        const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null;
        console.log(`Connection closed for user ${userId} with status:`, statusCode);
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(`Device logged out for user ${userId} - clearing session`);
          userSession.qr = '';
          userSession.isStarting = false;
          clearAuthSession(userId).then(() => {
            setTimeout(() => startSock(userId), 5000);
          });
        } else if (statusCode === DisconnectReason.restartRequired) {
          console.log(`Restart required for user ${userId} - reconnecting...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 3000);
        } else if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
          // Handle conflict/replaced connection - stop reconnecting to prevent loops
          console.log(`Connection conflict for user ${userId} - stopping reconnections to prevent conflicts`);
          userSession.isStarting = false;
          // Don't auto-reconnect on conflicts, user needs to manually restart
        } else if (statusCode === DisconnectReason.connectionLost || statusCode === DisconnectReason.connectionClosed) {
          console.log(`Connection lost for user ${userId} - reconnecting...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 5000);
        } else {
          // For other reasons, try to reconnect
          console.log(`Attempting reconnection for user ${userId}...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 8000);
        }
      } else if (connection === 'open') {
        userSession.connected = true;
        userSession.qr = '';
        console.log(`WhatsApp connected and authenticated successfully for user ${userId}!`);
      } else if (connection === 'connecting') {
        console.log(`Connecting to WhatsApp for user ${userId}...`);
      }
    });

    sock.ev.on('creds.update', saveCreds);
    userSession.sock = sock;
    userSession.isStarting = false;
    return sock;
  } catch (error) {
    console.error(`Error starting WhatsApp socket for user ${userId}:`, error);
    userSession.isStarting = false;
    setTimeout(() => startSock(userId), 5000);
  }
}

async function restartConnection(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  console.log(`Force restarting WhatsApp connection for user ${userId}...`);
  
  const userSession = userSessions.get(userId);
  if (!userSession) {
    throw new Error('User session not found');
  }
  
  // Close existing socket
  if (userSession.sock) {
    try {
      userSession.sock.end();
    } catch (error) {
      console.log(`Error ending socket for user ${userId}:`, error);
    }
  }
  
  // Reset user session variables
  userSession.sock = null;
  userSession.connected = false;
  userSession.qr = '';
  userSession.isStarting = false;
  
  // Clear session completely and start fresh
  await clearAuthSession(userId);
  
  // Wait a bit then start new session
  setTimeout(() => {
    startSock(userId);
  }, 2000);
}

exports.getQR = (req, res) => {
  const userId = req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const userSession = userSessions.get(userId);
  if (!userSession) {
    // Initialize session for new user
    startSock(userId);
    return res.json({ qr: "" });
  }

  res.json({ qr: userSession.qr || "" });
};

exports.getStatus = (req, res) => {
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
};

exports.getSock = (userId) => {
  if (!userId) return null;
  const userSession = userSessions.get(userId);
  return userSession ? userSession.sock : null;
};

exports.restartConnection = restartConnection;
exports.startSock = startSock;
