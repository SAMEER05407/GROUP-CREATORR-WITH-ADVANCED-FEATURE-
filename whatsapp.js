
import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';

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

async function startSock(userId, usePairingCode = false) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Get or create user session
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      qr: '',
      pairingCode: '',
      connected: false,
      sock: null,
      isStarting: false,
      usePairingCode: usePairingCode
    });
  }

  const userSession = userSessions.get(userId);
  
  if (userSession.isStarting) return;
  userSession.isStarting = true;
  
  // Update pairing code preference
  if (usePairingCode !== undefined) {
    userSession.usePairingCode = usePairingCode;
  }
  
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
    
    // Fetch latest version
    const { version } = await fetchLatestBaileysVersion();
    
    // Create proper logger for Baileys
    const logger = {
      level: 'silent',
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => logger
    };
    
    const sock = makeWASocket({ 
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser: ['WhatsApp Group Bot', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      keepAliveIntervalMs: 30000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      qrTimeout: 60000,
      getMessage: async (key) => {
        return { conversation: 'hello' };
      }
    });

    // Force QR mode only - pairing code disabled for stability
    userSession.usePairingCode = false;
    userSession.pairingCode = '';

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr && !userSession.usePairingCode) {
        // Generate QR data URL for web UI only
        qrcode.toDataURL(qr, (err, url) => {
          if (!err) {
            userSession.qr = url;
            userSession.pairingCode = '';
            console.log(`✅ New QR code generated for user ${userId}`);
          }
        });
      }
      
      if (connection === 'open') {
        userSession.connected = true;
        userSession.qr = '';
        userSession.isStarting = false;
        console.log(`✅ WhatsApp connected successfully for user ${userId}!`);
        
        // Save credentials immediately after successful connection
        try {
          await saveCreds();
          console.log(`💾 Session credentials saved for user ${userId}`);
        } catch (saveError) {
          console.error(`⚠️ Failed to save credentials for ${userId}:`, saveError.message);
        }
      } else if (connection === 'connecting') {
        console.log(`🔄 Connecting to WhatsApp for user ${userId}...`);
      } else if (connection === 'close') {
        userSession.connected = false;
        
        const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401 && statusCode !== 403;
        
        console.log(`Connection closed for user ${userId} with status:`, statusCode);
        
        // For 401/403/logged out - clear everything
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
          console.log(`❌ Device logged out for user ${userId} (code: ${statusCode})`);
          
          userSession.qr = '';
          userSession.pairingCode = '';
          userSession.phoneNumber = '';
          userSession.usePairingCode = false;
          userSession.isStarting = false;
          
          // Complete socket cleanup
          if (userSession.sock) {
            try {
              await userSession.sock.end();
              if (userSession.sock.ws) {
                userSession.sock.ws.close();
              }
            } catch (e) {}
            userSession.sock = null;
          }
          
          // Clear session files
          await clearAuthSession(userId);
          console.log(`✅ Session cleared for user ${userId}`);
          console.log(`⏸️ Please click "Restart & Get New QR" button to reconnect`);
          
        } else if (statusCode === DisconnectReason.restartRequired) {
          console.log(`🔄 Restart required for user ${userId} - reconnecting in 3s...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 3000);
          
        } else if (statusCode === DisconnectReason.connectionLost) {
          console.log(`📡 Connection lost for user ${userId} - reconnecting in 5s...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 5000);
          
        } else if (statusCode === DisconnectReason.badSession) {
          console.log(`❌ Bad session for user ${userId} - clearing and waiting for manual restart`);
          userSession.isStarting = false;
          await clearAuthSession(userId);
          console.log(`⏸️ Please click "Restart & Get New QR" button`);
          
        } else if (statusCode === DisconnectReason.timedOut) {
          console.log(`⏱️ Connection timed out for user ${userId} - retrying in 5s...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 5000);
          
        } else if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
          console.log(`⚠️ Connection replaced for user ${userId} - device connected elsewhere`);
          userSession.isStarting = false;
          console.log(`⏸️ Please click "Restart & Get New QR" button if you want to reconnect`);
          
        } else {
          console.log(`🔌 Disconnected for user ${userId} (code: ${statusCode}) - reconnecting in 5s...`);
          userSession.isStarting = false;
          setTimeout(() => startSock(userId), 5000);
        }
      }
    });

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        console.log(`💾 Credentials updated and saved for user ${userId}`);
      } catch (error) {
        console.error(`❌ Failed to save credentials for ${userId}:`, error.message);
      }
    });
    
    userSession.sock = sock;
    userSession.isStarting = false;
    return sock;
  } catch (error) {
    console.error(`❌ Error starting WhatsApp socket for user ${userId}:`, error);
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
  
  // If no session exists, create one
  if (!userSession) {
    console.log(`📝 Creating new session for user ${userId}`);
    userSessions.set(userId, {
      qr: '',
      pairingCode: '',
      connected: false,
      sock: null,
      isStarting: false,
      usePairingCode: false
    });
    userSession = userSessions.get(userId);
  }
  
  // Close existing socket completely
  if (userSession.sock) {
    try {
      userSession.sock.end();
      if (userSession.sock.ws) {
        userSession.sock.ws.close();
      }
      console.log(`✅ Closed existing socket for user ${userId}`);
    } catch (error) {
      console.log(`⚠️ Error closing socket (ignorable):`, error.message);
    }
  }
  
  // Reset ALL session variables
  userSession.sock = null;
  userSession.connected = false;
  userSession.qr = '';
  userSession.pairingCode = '';
  userSession.phoneNumber = '';
  userSession.usePairingCode = false;
  userSession.isStarting = false;
  
  console.log(`🧹 Clearing old session files for user ${userId}...`);
  
  // Clear session files completely
  await clearAuthSession(userId);
  
  console.log(`✅ Session cleared for user ${userId}`);
  console.log(`⏳ Starting fresh connection in 3 seconds...`);
  
  // Wait then start completely fresh session
  setTimeout(() => {
    console.log(`🚀 Starting fresh WhatsApp session for user ${userId}`);
    startSock(userId, false);
  }, 3000);
}

export function getQR(req, res) {
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
  return userSession ? userSession.sock : null;
}

export function getPairingCode(req, res) {
  const userId = req.headers['user-id'] || req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const userSession = userSessions.get(userId);
  if (!userSession) {
    return res.json({ pairingCode: "" });
  }

  res.json({ pairingCode: userSession.pairingCode || "" });
}

export function usePairingCode(req, res) {
  const userId = req.headers['user-id'] || req.body.userId;
  let phoneNumber = req.body.phoneNumber;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'WhatsApp phone number is required (with country code, e.g., 919209778319)' });
  }

  // Clean and validate phone number
  phoneNumber = phoneNumber.replace(/\D/g, ''); // Remove all non-digits
  
  if (phoneNumber.length < 10 || phoneNumber.length > 15) {
    return res.status(400).json({ 
      error: 'Invalid phone number length. Must be 10-15 digits with country code (e.g., 919209778319)' 
    });
  }
  
  // Ensure country code exists (if starts with 0, user forgot country code)
  if (phoneNumber.startsWith('0')) {
    return res.status(400).json({ 
      error: 'Please include country code. Example: 91 for India (919209778319)' 
    });
  }
  
  console.log(`📱 Requesting pairing code for cleaned number: ${phoneNumber}`);

  // Get or create user session and store phone number
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      qr: '',
      pairingCode: '',
      connected: false,
      sock: null,
      isStarting: false,
      usePairingCode: true,
      phoneNumber: phoneNumber
    });
  } else {
    const session = userSessions.get(userId);
    session.phoneNumber = phoneNumber;
    session.usePairingCode = true;
  }

  // Start connection with pairing code mode
  startSock(userId, true);
  res.json({ success: true, message: 'Pairing code mode activated for ' + phoneNumber });
}

export { restartConnection, startSock };
