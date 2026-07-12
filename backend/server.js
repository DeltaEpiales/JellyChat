require('dotenv').config();


const { execSync, exec } = require('child_process');
const http = require('http');

// Check for custom protocol args
const inviteArg = process.argv.find(arg => arg.startsWith('jellychat://'));

// Register protocol handler on Windows
if (process.platform === 'win32' && process.pkg) {
    try {
        const exePath = process.execPath;
        execSync(`reg add "HKCU\\Software\\Classes\\jellychat" /v "URL Protocol" /t REG_SZ /d "" /f`, { stdio: 'ignore' });
        execSync(`reg add "HKCU\\Software\\Classes\\jellychat\\shell\\open\\command" /ve /t REG_SZ /d "\"${exePath}\" \"%1\"" /f`, { stdio: 'ignore' });
    } catch (e) {
        // Ignore registry errors (might not have perms or already exists)
    }
}

let pendingInvite = null;


// Ensure Tailscale is installed (on windows)
if (process.platform === 'win32') {
    try {
        const child_process = require('child_process');
        child_process.execSync('tailscale status', { stdio: 'ignore' });
    } catch (e) {
        // Tailscale not found!
        const fs = require('fs');
        const path = require('path');
        const child_process = require('child_process');
        const installerPath = path.join(process.cwd(), 'tailscale-setup.exe');
        if (fs.existsSync(installerPath)) {
            console.log("Tailscale is required. Launching installer...");
            try {
                // start /wait will block Node until the installer exits
                child_process.execSync(`start /wait "" "${installerPath}"`);
                console.log("Installer exited. Checking if Tailscale is now available...");
                // Just to give the service a second to start
                const startWait = Date.now();
                while (Date.now() - startWait < 2000) { }
            } catch (err) {
                console.error("Installer failed or cancelled", err);
            }
        } else {
            console.error("Tailscale is required but installer not found at", installerPath);
        }
    }
}

if (inviteArg) {
    const invitePayload = inviteArg.replace('jellychat://invite/', '').replace(/\/$/, ''); // strip trailing slash just in case
    // If we were launched with an invite, we might be a second instance.
    // Try to send it to the existing instance.
    try {
        const req = http.request({
            hostname: '127.0.0.1',
            port: process.env.PORT || 4000,
            path: '/api/internal/invite',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            if (res.statusCode === 200) {
                console.log("Invite sent to existing instance. Exiting.");
                // We should also open the browser to bring it to foreground
                execSync('start http://localhost:' + (process.env.PORT || 4000));
                process.exit(0);
            }
        });
        req.on('error', (e) => {
            // Existing instance not running, we are the main instance.
            pendingInvite = invitePayload;
        });
        req.write(JSON.stringify({ payload: invitePayload }));
        req.end();

        // Wait a tiny bit for the request to succeed or fail
        const startWait = Date.now();
        while (Date.now() - startWait < 500) { }
    } catch (e) { }
}

// Ensure Tailscale is installed (on windows)
if (process.platform === 'win32') {
    try {
        execSync('tailscale status', { stdio: 'ignore' });
    } catch (e) {
        // Tailscale not found!
        const tsInstaller = path.join(process.cwd(), 'tailscale-setup.exe');
        if (fs.existsSync(tsInstaller)) {
            console.log("Tailscale is not installed! Launching installer...");
            execSync(`start "" "${tsInstaller}"`);
            console.log("Please complete the Tailscale installation and restart JellyChat.");
            process.exit(0);
        }
    }
}
// ==========================================
// GUIDED SETUP WIZARD (FIRST RUN)
// ==========================================
const path = require('path');
const fs = require('fs');
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath) && process.pkg) {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log("\n=======================================================");
    console.log("Welcome to JellyChat!");
    console.log("It looks like this is your first time running the server.");
    console.log("Let's get your environment configured.");
    console.log("=======================================================\n");

    const askQuestion = (query) => new Promise(resolve => readline.question(query, resolve));

    (async () => {
        let envContent = '';

        console.log("1. Tailscale Configuration (Required for P2P)");
        const tailnet = await askQuestion("Enter your Tailnet Name (e.g. alice@github or example.com): ");
        const tsApiKey = await askQuestion("Enter your Tailscale API Key: ");
        envContent += `TAILSCALE_TAILNET=${tailnet}\nTAILSCALE_API_KEY=${tsApiKey}\n\n`;

        console.log("\n2. GIF Integration (Optional, press Enter to skip)");
        const tenorKey = await askQuestion("Enter your Tenor V2 API Key: ");
        if (tenorKey) envContent += `TENOR_API_KEY=${tenorKey}\n\n`;

        console.log("\n3. AI Integrations (Optional, press Enter to skip)");
        const openWebUiUrl = await askQuestion("Enter OpenWebUI URL (default: http://localhost:3000): ");
        const openWebUiKey = await askQuestion("Enter OpenWebUI API Key: ");
        const comfyUrl = await askQuestion("Enter ComfyUI URL (default: http://127.0.0.1:8188): ");

        if (openWebUiUrl) envContent += `OPENWEBUI_URL=${openWebUiUrl}\n`;
        if (openWebUiKey) envContent += `OPENWEBUI_API_KEY=${openWebUiKey}\n`;
        if (comfyUrl) envContent += `COMFYUI_URL=${comfyUrl}\n`;

        fs.writeFileSync(envPath, envContent);

        console.log("\n=======================================================");
        console.log("Setup Complete! A .env file has been generated in:");
        console.log(process.cwd());
        console.log("\nPlease restart JellyChat.exe to apply your settings.");
        console.log("=======================================================\n");

        process.exit(0);
    })();
    return; // Stop further execution while waiting for async wizard
}
// ==========================================
const express = require('express');

const https = require('https');
const selfsigned = require('selfsigned');

const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const tailscale = require('./tailscale');
const webpush = require('web-push');
const { getLinkPreview } = require('link-preview-js');
const nodemailer = require('nodemailer');

const multer = require('multer');

const child_process = require('child_process');

const app = express();
app.set('trust proxy', 'loopback');
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        // Allow any localhost, 127.0.0.1, local network IP, or tailscale ts.net domain
        const isAllowed =
            origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            origin.includes('192.168.') ||
            origin.includes('100.') ||
            origin.includes('ts.net');

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    }
};
app.use(cors(corsOptions));
app.use(express.json());

// WebKey Auth Middleware
app.use(async (req, res, next) => {
    let token = req.headers['x-web-token'] || req.headers.authorization;
    if (token) {
        if (token.startsWith('Bearer ')) token = token.substring(7);
        try {
            const session = await db.getWebSession(token);
            if (session) {
                req.webUser = session;
            }
        } catch (e) {
            console.error("Auth error", e);
        }
    }
    next();
});

function getClientId(req) {
    if (req.webUser) {
        return 'web_' + req.webUser.token.substring(0, 8); // Use short token as ID
    }
    const rawIp = req.ip || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
    return rawIp.replace(/^::ffff:/, '');
}


app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Setup Web Push
const vapidKeys = JSON.parse(fs.readFileSync(path.join(__dirname, 'vapidKeys.json'), 'utf8'));
webpush.setVapidDetails(
    'mailto:test@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Setup uploads dir
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Setup roms dir
const romsDir = path.join(process.cwd(), 'roms');
if (!fs.existsSync(romsDir)) {
    fs.mkdirSync(romsDir);
}
app.use('/roms', express.static(romsDir));

// Multer storage config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        const ext = path.extname(file.originalname) || '.png';
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions
});

const peerSockets = new Map();

const voiceRooms = {}; // Maps channelId to array of { socketId, ip, name, profileId }

// Middleware to attach Tailscale device name to socket
io.use((socket, next) => {
    let ip = socket.handshake.address.replace(/^::ffff:/, '');

    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) {
            ip = selfIps[0]; // Use primary IPv4
        }
    }

    socket.tailscaleDeviceName = tailscale.getDeviceNameByIp(ip);
    socket.tailscaleIp = ip;
    next();
});

const connectedIps = new Set();
const peerActivities = new Map(); // ip -> activity object
const peerStatuses = new Map(); // ip -> { status: string, text: string }
let activeSandboxes = {};
db.loadSandboxStates().then(s => {
    activeSandboxes = s;
    db.cleanupOldSandboxes();
    console.log('Loaded ' + Object.keys(s).length + ' sandbox channel states from DB');
}).catch(e => console.error('Error loading sandboxes:', e));

io.on('connection', async (socket) => {
    const rawIp = socket.handshake.address.replace(/^::ffff:/, '');
    const cookies = require('cookie').parse(socket.handshake.headers.cookie || '');
    const isProxy = (rawIp === '127.0.0.1' || rawIp === '::1');
    if (isProxy && cookies.funnel_auth) {
        try {
            const { token, username } = JSON.parse(Buffer.from(cookies.funnel_auth, 'base64').toString('utf8'));
            const db = require('./db');
            db.getFunnelInvite(token).then((invite) => {
                if (!invite || Date.now() > invite.expires_at) {
                    socket.disconnect();
                    return;
                }
                // Is valid funnel guest
                const peerInfo = {
                    ip: 'funnel-' + token.substring(0, 8),
                    name: username + ' (Guest)',
                    os: 'Web (Funnel)',
                    isJellychatOnline: true,
                    latency: 0
                };
                tailscale.peers[peerInfo.ip] = peerInfo;
                socket.tailscaleIp = peerInfo.ip;
                socket.tailscaleDeviceName = peerInfo.name;
                console.log("Guest connected via funnel:", peerInfo.name);
                io.emit('peers_updated', Object.values(tailscale.peers));
            }).catch(() => {
                socket.disconnect();
            });
        } catch (e) {
            socket.disconnect();
        }
    }

    console.log(`User connected: ${socket.tailscaleDeviceName} (${socket.tailscaleIp})`);
    connectedIps.add(socket.tailscaleIp);

    // Join personal room based on IP for P2P messaging
    socket.join(socket.tailscaleIp);

    // Join profile room if assigned
    try {
        const profileId = await db.getDeviceAssignment(socket.tailscaleIp);
        if (profileId) {
            socket.join(profileId);
        }
    } catch (err) {
        console.error('Failed to get profile for socket', err);
    }

    // Send global messages by default on connect
    try {
        const messages = await db.getMessages(null, null, 100);
        socket.emit('initial_messages', messages);
        socket.emit('active_voice_channels', voiceRooms);
    } catch (err) {
        console.error('Error fetching messages', err);
    }

    // Allow client to fetch messages for a specific chat (channel or p2p)
    socket.on('fetch_messages', async (data, callback) => {
        try {
            // Support backward compatibility
            const recipientId = typeof data === 'object' ? data.recipientId : data;
            const channelId = typeof data === 'object' ? data.channelId : 'general';

            let messages;
            if (!recipientId) {
                messages = await db.getMessages(null, null, channelId, 100);
            } else {
                messages = await db.getMessages(socket.tailscaleIp, recipientId, null, 100);
            }
            if (typeof callback === 'function') {
                callback(messages);
            } else {
                socket.emit('initial_messages', messages);
            }
        } catch (err) {
            console.error('Error fetching messages', err);
        }
    });

    socket.on('join_channel', (channelId) => {
        // Leave previous channels if necessary, or just join (Socket.io allows multiple)
        socket.join(`channel_${channelId}`);
    });

    socket.on('leave_channel', (channelId) => {
        socket.leave(`channel_${channelId}`);
    });

    socket.on('send_message', async (data) => {
        try {
            // support backward compatibility where data is just a string
            const content = typeof data === 'string' ? data : data.content;
            const recipientId = typeof data === 'string' ? null : data.recipientId;
            const replyToId = typeof data === 'string' ? null : data.replyToId;
            const type = typeof data === 'string' ? 'text' : (data.type || 'text');
            const attachmentUrl = typeof data === 'string' ? null : (data.attachmentUrl || null);
            const channelId = typeof data === 'string' ? 'general' : (data.channelId || 'general');
            const ttl = typeof data === 'string' ? null : (data.ttl || null);

            const savedMessage = await db.saveMessage(socket.tailscaleIp, socket.tailscaleDeviceName, content, recipientId, type, attachmentUrl, null, replyToId, channelId, ttl);

            if (!recipientId) {
                // Broadcast to channel room
                io.to(`channel_${channelId}`).emit('new_message', savedMessage);
            } else {
                // Send to recipient's personal room
                io.to(recipientId).emit('new_message', savedMessage);
                // And send back to the sender
                socket.emit('new_message', savedMessage);
            }

            // Trigger Web Push Notifications
            sendPushNotification(savedMessage, recipientId);

            // Check for Agent triggers or @image trigger
            const settings = await db.getSettings();
            const agent1Name = (settings['agent1_name'] || 'Mimir').toLowerCase();
            const agent2Name = (settings['agent2_name'] || 'Jarvis').toLowerCase();

            const lowerContent = content ? content.toLowerCase() : '';
            let isAgent1Tagged = lowerContent.includes(`@${agent1Name}`);
            let isAgent2Tagged = lowerContent.includes(`@${agent2Name}`);
            let isImageTagged = lowerContent.startsWith('@image');

            if (isAgent1Tagged || isAgent2Tagged) {
                // Strip all agent tags to form the clean prompt
                let cleanPrompt = content;
                if (isAgent1Tagged) {
                    const regex1 = new RegExp(`@${agent1Name}\\b`, 'gi');
                    cleanPrompt = cleanPrompt.replace(regex1, '');
                }
                if (isAgent2Tagged) {
                    const regex2 = new RegExp(`@${agent2Name}\\b`, 'gi');
                    cleanPrompt = cleanPrompt.replace(regex2, '');
                }
                cleanPrompt = cleanPrompt.trim();

                if (isAgent1Tagged) {
                    handleAgentMessage(socket, savedMessage, channelId, recipientId, settings['agent1_name'] || 'Mimir', settings['agent1_model'], cleanPrompt);
                }
                if (isAgent2Tagged) {
                    handleAgentMessage(socket, savedMessage, channelId, recipientId, settings['agent2_name'] || 'Jarvis', settings['agent2_model'], cleanPrompt);
                }
            } else if (isImageTagged) {
                handleImageMessage(socket, savedMessage, channelId, recipientId);
            }

            // Update channel summaries
            const lastMessages = await db.getLastMessagePerChannel();
            const counts = await db.getChannelMessageCounts();
            io.emit('channel_unread_summary', { lastMessages, counts });
        } catch (err) {
            console.error('Error saving message', err);
        }
    });

    socket.on('send_nudge', (recipientId) => {
        if (recipientId) {
            io.to(recipientId).emit('receive_nudge', { senderName: socket.tailscaleDeviceName, senderId: socket.tailscaleIp });
        }
    });

    socket.on('typing', (data) => {
        const { recipientId, isTyping } = data;
        if (recipientId) {
            io.to(recipientId).emit('typing', { senderId: socket.tailscaleIp, isTyping, recipientId });
        } else {
            socket.broadcast.emit('typing', { senderId: socket.tailscaleIp, isTyping, recipientId: null });
        }
    });

    socket.on('mark_delivered', async (messageIds) => {
        try {
            await db.updateMessageStatus(messageIds, 'delivered');
            io.emit('messages_status_updated', { messageIds, status: 'delivered' });
        } catch (err) {
            console.error('Error marking delivered', err);
        }
    });

    socket.on('mark_read', async (messageIds) => {
        try {
            await db.updateMessageStatus(messageIds, 'read');
            io.emit('messages_status_updated', { messageIds, status: 'read' });
        } catch (err) {
            console.error('Error marking read', err);
        }
    });

    socket.on('add_reaction', async ({ messageId, emoji }) => {
        try {
            const reactions = await db.addReaction(messageId, socket.tailscaleIp, emoji);
            io.emit('reaction_updated', { messageId, reactions });
        } catch (err) {
            console.error('Error adding reaction', err);
        }
    });

    socket.on('add_sticker', async ({ messageId, sticker }) => {
        try {
            const stickers = await db.addSticker(messageId, sticker);
            io.emit('sticker_added', { messageId, stickers });
        } catch (err) {
            console.error('Error adding sticker', err);
        }
    });

    socket.on('edit_message', async ({ messageId, newContent }) => {
        try {
            await db.editMessage(messageId, newContent);
            io.emit('message_edited', { messageId, newContent });
        } catch (err) {
            console.error('Error editing message', err);
        }
    });

    socket.on('purge_channel', async (channelId) => {
        try {
            await db.purgeChannelMessages(channelId);
            io.emit('channel_purged', channelId);
        } catch (err) {
            console.error('Error purging channel', err);
        }
    });
    socket.on('delete_message', async (messageId) => {
      try {
          await db.deleteMessage(messageId);
          io.emit('message_deleted', messageId);
      } catch (err) {
          console.error('Error deleting message', err);
      }
  });

  // --- Collaborative Workspace ---
  socket.on('join_workspace', (room) => {
      socket.join(room);
  });
  
  // --- Collaborative Sandbox Events ---
  socket.on('sandbox:create', ({ channelId, sandboxId, language, code, files, activeFile }) => {
      if (!activeSandboxes[channelId]) activeSandboxes[channelId] = {};
      
      if (!activeSandboxes[channelId][sandboxId]) {
          if (files && activeFile) {
              activeSandboxes[channelId][sandboxId] = { files, activeFile };
          } else {
              activeSandboxes[channelId][sandboxId] = { files: { 'index.js': { language: language || 'javascript', code: code || '' } }, activeFile: 'index.js' };
          }
          db.saveSandboxState(channelId, sandboxId, activeSandboxes[channelId][sandboxId]).catch(console.error);
      }
      socket.emit('sandbox:update', { channelId, sandboxId, ...activeSandboxes[channelId][sandboxId] });
  });

  socket.on('sandbox:update_file', ({ channelId, sandboxId, filename, code, language, changes }) => {
      if (activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
          const sb = activeSandboxes[channelId][sandboxId];
          if (!sb.files[filename]) sb.files[filename] = { language: language || 'javascript', code: '' };
          if (code !== undefined) sb.files[filename].code = code;
          if (language !== undefined) sb.files[filename].language = language;
          db.saveSandboxState(channelId, sandboxId, sb).catch(console.error);
          socket.broadcast.emit('sandbox:update_file_receive', { channelId, sandboxId, filename, code, language, changes });
      }
  });

  socket.on('sandbox:switch_file', ({ channelId, sandboxId, filename }) => {
      if (activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
          activeSandboxes[channelId][sandboxId].activeFile = filename;
          db.saveSandboxState(channelId, sandboxId, activeSandboxes[channelId][sandboxId]).catch(console.error);
          socket.broadcast.emit('sandbox:update', { channelId, sandboxId, files: activeSandboxes[channelId][sandboxId].files, activeFile: filename });
      }
  });

  socket.on('sandbox:create_file', ({ channelId, sandboxId, filename, language }) => {
      if (activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
          const sb = activeSandboxes[channelId][sandboxId];
          sb.files[filename] = { language, code: '' };
          sb.activeFile = filename;
          db.saveSandboxState(channelId, sandboxId, sb).catch(console.error);
          io.emit('sandbox:update', { channelId, sandboxId, files: sb.files, activeFile: sb.activeFile });
      }
  });

  socket.on('sandbox:delete_file', ({ channelId, sandboxId, filename }) => {
      if (activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
          const sb = activeSandboxes[channelId][sandboxId];
          delete sb.files[filename];
          const keys = Object.keys(sb.files);
          if (sb.activeFile === filename) {
              sb.activeFile = keys.length > 0 ? keys[0] : null;
          }
          db.saveSandboxState(channelId, sandboxId, sb).catch(console.error);
          io.emit('sandbox:update', { channelId, sandboxId, files: sb.files, activeFile: sb.activeFile });
      }
  });

    socket.on('sandbox:pointer', ({ channelId, sandboxId, data }) => {
        socket.broadcast.emit('sandbox:pointer_receive', {
            channelId,
            sandboxId,
            socketId: socket.id,
            ip: socket.tailscaleIp,
            name: socket.tailscaleDeviceName,
            ...data
        });
    });

    socket.on('sandbox:cursor', ({ channelId, sandboxId, data }) => {
        socket.broadcast.emit('sandbox:cursor_receive', {
            channelId,
            sandboxId,
            socketId: socket.id,
            name: socket.tailscaleDeviceName,
            ...data
        });
    });

    socket.on('sandbox:execute', ({ channelId, sandboxId, language, code, runId }) => {
        if (!runId) runId = Math.random().toString(36).substring(7);
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        let filename, cmd;
        if (language === 'python') {
            filename = `sandbox_${runId}.py`;
            cmd = `python3 ${filename}`;
        } else if (language === 'javascript') {
            filename = `sandbox_${runId}.js`;
            cmd = `node ${filename}`;
        } else if (language === 'cpp') {
            filename = `sandbox_${runId}.cpp`;
            cmd = `g++ ${filename} -o sandbox_${runId}.exe && ./sandbox_${runId}.exe`;
        } else if (language === 'lua') {
            filename = `sandbox_${runId}.lua`;
            cmd = `lua ${filename}`;
        } else if (language === 'go') {
            filename = `sandbox_${runId}.go`;
            cmd = `go run ${filename}`;
        } else if (language === 'ruby') {
            filename = `sandbox_${runId}.rb`;
            cmd = `ruby ${filename}`;
        } else if (language === 'perl') {
            filename = `sandbox_${runId}.pl`;
            cmd = `perl ${filename}`;
        } else {
            io.to(socket.id).emit('sandbox:execute_result', {
                channelId,
                sandboxId,
                logs: [`[ERROR] Unsupported local language: ${language}`]
            });
            return;
        }


        const filepath = path.join(tempDir, filename);
        fs.writeFileSync(filepath, code);

        const child = exec(cmd, { cwd: tempDir, timeout: 10000 }, (error, stdout, stderr) => {
            const logs = [];
            if (error) {
                if (error.killed) {
                    logs.push(`\n[Execution Timeout]`);
                } else if (error.code) {
                    logs.push(`\n[Exited with code ${error.code}]`);
                }
            }

            io.to(socket.id).emit('sandbox:execute_result', {
                channelId,
                sandboxId,
                logs
            });

            try {
                if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                if (language === 'cpp') {
                    const exePath = path.join(tempDir, `sandbox_${runId}.exe`);
                    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
                }
            } catch(e) {}
        });

        child.stdout.on('data', (data) => {
            io.to(socket.id).emit('sandbox:execute_stream', { channelId, sandboxId, output: data.toString() });
        });
        
        child.stderr.on('data', (data) => {
            io.to(socket.id).emit('sandbox:execute_stream', { channelId, sandboxId, output: data.toString() });
        });
    });

    socket.on('sandbox:execute_project', ({ channelId, sandboxId, files, runId }) => {
        if (!runId) runId = Math.random().toString(36).substring(7);
        const tempDir = path.join(__dirname, 'temp', `proj_${runId}`);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        let cmd = '';
        let hasStartScript = false;

        // Write all files
        for (const [filename, fileObj] of Object.entries(files)) {
            const filepath = path.join(tempDir, filename);
            // Ensure directories exist for nested files if any
            const dirname = path.dirname(filepath);
            if (!fs.existsSync(dirname)) fs.mkdirSync(dirname, { recursive: true });
            fs.writeFileSync(filepath, fileObj.code);
        }

        if (files['package.json']) {
            cmd = 'npm install && npm start';
            hasStartScript = true;
        } else if (files['main.py']) {
            cmd = 'python3 main.py';
            hasStartScript = true;
        } else if (files['index.js']) {
            cmd = 'node index.js';
            hasStartScript = true;
        } else if (files['main.cpp']) {
            cmd = 'g++ *.cpp -o main.exe && ./main.exe';
            hasStartScript = true;
        } else if (files['main.lua']) {
            cmd = 'lua main.lua';
            hasStartScript = true;
        } else if (files['main.go']) {
            cmd = 'go run main.go';
            hasStartScript = true;
        } else if (files['main.rb']) {
            cmd = 'ruby main.rb';
            hasStartScript = true;
        } else if (files['main.pl']) {
            cmd = 'perl main.pl';
            hasStartScript = true;
        } else if (files['index.html']) {
            io.to(socket.id).emit('sandbox:execute_result', {
                channelId,
                sandboxId,
                logs: ['> Static Web Project Detected.', '> App Preview is ready. Check the Preview tab!']
            });
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
            return;
        }

        if (!hasStartScript) {
            io.to(socket.id).emit('sandbox:execute_result', {
                channelId,
                sandboxId,
                logs: ['[ERROR] No entry point found (e.g. main.py, index.js, package.json)']
            });
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
            return;
        }

        const child = exec(cmd, { cwd: tempDir, timeout: 30000 }, (error, stdout, stderr) => {
            const logs = [];
            if (error) {
                if (error.killed) {
                    logs.push(`\n[Execution Timeout]`);
                } else if (error.code) {
                    logs.push(`\n[Exited with code ${error.code}]`);
                }
            }

            io.to(socket.id).emit('sandbox:execute_result', {
                channelId,
                sandboxId,
                logs
            });

            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch(e) {}
        });

        child.stdout.on('data', (data) => {
            io.to(socket.id).emit('sandbox:execute_stream', { channelId, sandboxId, output: data.toString() });
        });
        
        child.stderr.on('data', (data) => {
            io.to(socket.id).emit('sandbox:execute_stream', { channelId, sandboxId, output: data.toString() });
        });
    });

    socket.on('agent:get_models', async () => {
        try {
            const settings = await db.getSettings();
            const openWebUiUrl = settings['openwebui_url'] || process.env.OPENWEBUI_URL || 'http://localhost:3000';
            const apiKey = settings['openwebui_api_key'] || process.env.OPENWEBUI_API_KEY || '';
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

            const response = await fetch(`${openWebUiUrl}/api/models`, { headers });
            if (response.ok) {
                const data = await response.json();
                socket.emit('agent:models', data.data || []);
            }
        } catch (err) {
            console.error('Failed to fetch models from OpenWebUI', err);
            socket.emit('agent:models', []);
        }
    });

    socket.on('agent:chat', async (data) => {
        const { model: requestedModel, message, channelId, sandboxId, history } = data;
        const settings = await db.getSettings();
        const openWebUiUrl = settings['openwebui_url'] || process.env.OPENWEBUI_URL || 'http://localhost:3000';
        const apiKey = settings['openwebui_api_key'] || process.env.OPENWEBUI_API_KEY || '';

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        
        let model = requestedModel || settings['openwebui_model'] || process.env.OPENWEBUI_MODEL || 'llama3';

        let chatHistory = history || [];
        let systemPrompt = 'You are an AI programming assistant embedded directly in the Jellychat IDE. Be helpful, concise, and format code clearly.';

        if (channelId && sandboxId && activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
            const sbData = activeSandboxes[channelId][sandboxId];
            systemPrompt += `\n\nThe user is currently working in their Collaborative Sandbox (Multi-File Workspace). Here are the files:\n\n`;
            for (const [filename, fileData] of Object.entries(sbData.files)) {
                systemPrompt += `--- FILE: ${filename} (Language: ${fileData.language}) ---\n\`\`\`${fileData.language}\n${fileData.code}\n\`\`\`\n\n`;
            }
            systemPrompt += `The active file they are viewing is: ${sbData.activeFile}.\nCRITICAL: DO NOT use markdown code blocks (\\\`\\\`\\\`). Instead, directly update the sandbox by wrapping your code in these tags:\n<sandbox_update filename="filename.ext" language="javascript">\nYOUR CODE HERE\n</sandbox_update>\nYou can update multiple files by using multiple tags.`;
        }

        try {
            const response = await fetch(`${openWebUiUrl}/api/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...chatHistory,
                        { role: 'user', content: message }
                    ],
                    stream: true
                })
            });

            if (!response.ok || (response.headers.get('content-type') && response.headers.get('content-type').includes('text/html'))) {
                socket.emit('agent:stream', { error: await response.text() });
                return;
            }

            let fullResponse = '';
            const reader = response.body;
            const decoder = new TextDecoder();
            let firstChunkChecked = false;
            let rawAccumulator = '';

            for await (const chunk of reader) {
                const text = decoder.decode(chunk, { stream: true });
                rawAccumulator += text;

                // Check the very first chunk for HTML or JSON error responses
                if (!firstChunkChecked) {
                    firstChunkChecked = true;
                    const trimmed = rawAccumulator.trim();
                    if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
                        console.error(`[Agent] Received HTML instead of SSE stream`);
                        socket.emit('agent:stream', { error: `⚠️ AI server returned an error page. The model "${model}" may not be loaded. Check LM Studio.` });
                        return;
                    }
                    if (trimmed.startsWith('{')) {
                        try {
                            const errObj = JSON.parse(trimmed);
                            if (errObj.error || errObj.detail) {
                                const errText = errObj.error?.message || errObj.detail || JSON.stringify(errObj);
                                socket.emit('agent:stream', { error: `⚠️ AI Error: ${errText}` });
                                return;
                            }
                        } catch(e) {}
                    }
                }

                const lines = text.split('\n').filter(line => line.trim().startsWith('data:'));
                for (const line of lines) {
                    const jsonStr = line.replace(/^data:\s*/, '').trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.error) {
                            socket.emit('agent:stream', { error: `⚠️ AI Error: ${parsed.error?.message || parsed.error}` });
                            return;
                        }
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
                        
                        if (reasoning) {
                            if (!fullResponse.includes('<think>')) fullResponse += '<think>\n';
                            fullResponse += reasoning;
                            socket.emit('agent:stream', { chunk: reasoning, fullContent: fullResponse });
                        }

                        if (delta) {
                            if (fullResponse.includes('<think>') && !fullResponse.includes('</think>')) {
                                fullResponse += '\n</think>\n\n';
                            }
                            fullResponse += delta;
                            socket.emit('agent:stream', { chunk: delta, fullContent: fullResponse });
                        }
                    } catch(e) {
                        console.warn(`[Agent] Failed to parse SSE chunk:`, jsonStr.substring(0, 200));
                    }
                }
            }
            console.log(`[Agent] Stream ended, fullResponse length=${fullResponse.length}`);
            socket.emit('agent:stream_done');
            
            // Auto-apply sandbox code
            if (channelId && sandboxId && activeSandboxes[channelId] && activeSandboxes[channelId][sandboxId]) {
                const regex = /<sandbox_update\s+filename="([^"]+)"\s+language="([^"]+)">\n?([\s\S]*?)<\/sandbox_update>/g;
                let match;
                let updated = false;
                while ((match = regex.exec(fullResponse)) !== null) {
                    const filename = match[1];
                    const language = match[2];
                    const code = match[3].trim();
                    const sb = activeSandboxes[channelId][sandboxId];
                    if (!sb.files[filename]) sb.files[filename] = { language, code: '' };
                    sb.files[filename].code = code;
                    sb.files[filename].language = language;
                    sb.activeFile = filename; // switch to the last updated file
                    updated = true;
                }
                if (updated) {
                    io.emit('sandbox:update', { channelId, sandboxId, files: activeSandboxes[channelId][sandboxId].files, activeFile: activeSandboxes[channelId][sandboxId].activeFile });
                }
            }
        } catch (err) {
            socket.emit('agent:stream', { error: err.message });
        }
    });

    socket.on('workspace_draw', ({ room, data }) => {
        socket.to(room).emit('workspace_draw_receive', data);
    });
  socket.on('workspace_undo', ({ room, strokeId }) => {
      socket.to(room).emit('workspace_undo_receive', { strokeId });
  });

  socket.on('workspace_clear', ({ room }) => {
      socket.to(room).emit('workspace_clear_receive', {});
  });

  socket.on('workspace_pointer', ({ room, data }) => {
      socket.to(room).emit('workspace_pointer_receive', {
          socketId: socket.id,
          ip: socket.tailscaleIp,
          name: socket.tailscaleDeviceName,
          ...data
      });
  });

  socket.on('workspace_frames', ({ room, data }) => {
      socket.to(room).emit('workspace_frames_receive', data);
  });

  socket.on('workspace_frame_change', ({ room, data }) => {
      socket.to(room).emit('workspace_frame_change_receive', data);
  });

  // --- WebRTC Signaling ---
  socket.on('call_offer', (data) => {
      io.to(data.recipientId).emit('call_offer', { ...data, callerId: socket.tailscaleIp, callerName: socket.tailscaleDeviceName });
      sendPushNotification({ 
          content: `${socket.tailscaleDeviceName} is calling you...`, 
          senderName: 'Incoming Call' 
      }, data.recipientId);
  });

  socket.on('call_answer', (data) => {
      io.to(data.toId).emit('call_answer', data);
  });

  socket.on('ice_candidate', (data) => {
      io.to(data.toId).emit('ice_candidate', data);
  });

  socket.on('end_call', (data) => {
      if (data.toId) {
          io.to(data.toId).emit('end_call');
      }
  });

  socket.on('reject_call', (data) => {
      if (data.toId) {
          io.to(data.toId).emit('reject_call');
      }
  });

  // --- Voice Channels ---
  socket.on('join_voice_channel', async ({ channelId }) => {
      for (const cid in voiceRooms) {
          voiceRooms[cid] = voiceRooms[cid].filter(u => u.socketId !== socket.id);
          io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
          socket.leave(`channel_voice_${cid}`);
      }
      io.emit('active_voice_channels', voiceRooms);

      if (!voiceRooms[channelId]) voiceRooms[channelId] = [];
      
      const assignments = await db.getDeviceAssignments();
      const assignment = assignments.find(a => a.ip === socket.tailscaleIp);
      
      const userObj = {
          socketId: socket.id,
          ip: socket.tailscaleIp,
          name: socket.tailscaleDeviceName,
          profileId: assignment ? assignment.profileId : null
      };

      voiceRooms[channelId].push(userObj);
      socket.join(`channel_voice_${channelId}`);
      
      io.to(`channel_voice_${channelId}`).emit('voice_users_updated', { channelId, users: voiceRooms[channelId] });
      io.emit('active_voice_channels', voiceRooms);
  });

  socket.on('leave_voice_channel', () => {
      let changed = false;
      for (const cid in voiceRooms) {
          const idx = voiceRooms[cid].findIndex(u => u.socketId === socket.id);
          if (idx !== -1) {
              voiceRooms[cid].splice(idx, 1);
              io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
              socket.leave(`channel_voice_${cid}`);
              changed = true;
          }
      }
      if (changed) io.emit('active_voice_channels', voiceRooms);
  });

  socket.on('voice_signal', (data) => {
      io.to(data.toId).emit('voice_signal', {
          fromId: socket.id,
          type: data.type,
          payload: data.payload,
          peerIp: socket.tailscaleIp,
          peerName: socket.tailscaleDeviceName
      });
  });

  socket.on('disconnect', () => {
      let changed = false;
      for (const cid in voiceRooms) {
          const idx = voiceRooms[cid].findIndex(u => u.socketId === socket.id);
          if (idx !== -1) {
              voiceRooms[cid].splice(idx, 1);
              io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
              changed = true;
          }
      }
      if (changed) io.emit('active_voice_channels', voiceRooms);

      console.log(`User disconnected: ${socket.tailscaleDeviceName}`);
      connectedIps.delete(socket.tailscaleIp);
      if (typeof peerActivities !== 'undefined') {
          peerActivities.delete(socket.tailscaleIp);
      }
      io.emit('activity_update', { ip: socket.tailscaleIp, activity: null });

      io.emit('peer_offline', { ip: socket.tailscaleIp });
      for (const [ip, sid] of peerSockets.entries()) {
          if (sid === socket.id) {
              peerSockets.delete(ip);
              break;
          }
      }
  });

  socket.on('reset_global_chat', async () => {
    try {
      await db.clearGlobalChat();
      io.emit('chat_cleared');
    } catch (err) {
      console.error('Error clearing global chat', err);
    }
  });

  socket.on('update_activity', (activity) => {
      if (activity) {
          peerActivities.set(socket.tailscaleIp, activity);
      } else {
          peerActivities.delete(socket.tailscaleIp);
      }
      io.emit('activity_update', { ip: socket.tailscaleIp, activity });
  });

  socket.on('update_status', (statusData) => {
      if (statusData) {
          peerStatuses.set(socket.tailscaleIp, statusData);
      } else {
          peerStatuses.delete(socket.tailscaleIp);
      }
      io.emit('status_update', { ip: socket.tailscaleIp, ...statusData });
  });

  socket.on('update_steam_info', (steamData) => {
      if (steamData && steamData.personaName) {
          peerSteamInfo.set(socket.tailscaleIp, {
              personaName: steamData.personaName,
              steamId: steamData.steamId || null,
              installedApps: steamData.installedApps || []
          });
      } else {
          peerSteamInfo.delete(socket.tailscaleIp);
      }
      io.emit('steam_info_update', { ip: socket.tailscaleIp, steamData: peerSteamInfo.get(socket.tailscaleIp) || null });
  });

  socket.on('file_offer', (data) => {
      io.to(data.recipientId).emit('file_offer', {
          senderId: socket.tailscaleIp,
          senderName: socket.tailscaleDeviceName,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
          offer: data.offer
      });
  });

  socket.on('file_answer', (data) => {
      io.to(data.recipientId).emit('file_answer', {
          senderId: socket.tailscaleIp,
          answer: data.answer
      });
  });

  socket.on('file_ice', (data) => {
      io.to(data.recipientId).emit('file_ice', {
          senderId: socket.tailscaleIp,
          candidate: data.candidate
      });
  });

  socket.on('request_folder_sync', (data) => {
      io.to(data.recipientId).emit('request_folder_sync', {
          senderId: socket.tailscaleIp,
          folderName: data.folderName
      });
  });

  socket.on('folder_sync_progress', (data) => {
      io.to(data.recipientId).emit('folder_sync_progress', {
          senderId: socket.tailscaleIp,
          status: data.status,
          progress: data.progress,
          currentFile: data.currentFile,
          eta: data.eta,
          speed: data.speed
      });
  });

  socket.on('folder_sync_chunk', (data) => {
      io.to(data.recipientId).emit('folder_sync_chunk', {
          senderId: socket.tailscaleIp,
          chunk: data.chunk,
          index: data.index,
          total: data.total
      });
  });

  socket.on('folder_sync_complete', (data) => {
      io.to(data.recipientId).emit('folder_sync_complete', {
          senderId: socket.tailscaleIp,
          folderName: data.folderName
      });
  });

  socket.on('p2p_file_start', (data) => {
      io.to(data.recipientId).emit('p2p_file_start', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType
      });
  });

  socket.on('p2p_file_chunk', (data) => {
      io.to(data.recipientId).emit('p2p_file_chunk', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName,
          chunk: data.chunk,
          index: data.index,
          totalChunks: data.totalChunks
      });
  });

  socket.on('p2p_file_complete', (data) => {
      io.to(data.recipientId).emit('p2p_file_complete', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName
      });
  });

});

// --- Multi-Agent Support ---
async function handleAgentMessage(socket, triggerMessage, channelId, recipientId, agentName, specificModel, cleanPrompt) {
    const settings = await db.getSettings();
    const openWebUiUrl = settings['openwebui_url'] || process.env.OPENWEBUI_URL || 'http://localhost:3000';
    const apiKey = settings['openwebui_api_key'] || process.env.OPENWEBUI_API_KEY || '';
    if (!cleanPrompt) return;

    try {
        let contextMessages = [];
        if (!recipientId) {
            contextMessages = await db.getMessages(null, null, channelId, 20);
        } else {
            contextMessages = await db.getMessages(socket.tailscaleIp, recipientId, null, 20);
        }

        const filteredHistory = contextMessages.filter(m => m.id !== triggerMessage.id && m.content);
        const rawHistory = filteredHistory.map(m => {
            let content = m.content || '';
            // Strip <think> reasoning blocks from history to save context
            content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            // Skip empty/error/warning fallback messages
            if (!content || content.includes('I got an empty response') || content.startsWith('⚠️')) return null;
            // Strip @agent tags from history to prevent OpenWebUI re-routing
            content = content.replace(/@\w+/g, '').trim();
            if (!content) return null;
            // Truncate very long messages to prevent context overflow
            if (content.length > 2000) content = content.substring(0, 2000) + '...[truncated]';
            return {
                role: (!m.senderId.includes('.') && m.senderId !== 'system') ? 'assistant' : 'user',
                content: content
            };
        }).filter(Boolean);

        // Merge consecutive messages with the same role (some Jinja templates break on these)
        const chatHistory = [];
        for (const msg of rawHistory) {
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === msg.role) {
                chatHistory[chatHistory.length - 1].content += '\n' + msg.content;
            } else {
                chatHistory.push({ ...msg });
            }
        }

        let systemPrompt = `You are ${agentName}, a helpful AI assistant operating within the Jellychat interface. Your primary purpose is to assist users with their questions and tasks.`;

        // --- Sandbox Context Injection ---
        let mentionedSandboxId = null;
        const sandboxMatch = cleanPrompt.match(/SB\d+/i);
        if (sandboxMatch) {
            mentionedSandboxId = sandboxMatch[0].toUpperCase();
            if (activeSandboxes[channelId] && activeSandboxes[channelId][mentionedSandboxId]) {
                const sbData = activeSandboxes[channelId][mentionedSandboxId];
                systemPrompt += `\n\nThe user mentioned sandbox ${mentionedSandboxId}. Here is its current code (language: ${sbData.language}):\n\`\`\`${sbData.language}\n${sbData.code}\n\`\`\`\n\nIf the user asks you to modify or fix it, simply output the new code wrapped in a markdown code block. Do NOT include any other code blocks.`;
            }
        }

        const botMessage = await db.saveMessage(agentName.toLowerCase(), agentName, '', recipientId, 'text', null, null, triggerMessage.id, channelId);

        if (!recipientId) {
            io.to(`channel_${channelId}`).emit('new_message', botMessage);
        } else {
            io.to(recipientId).emit('new_message', botMessage);
            socket.emit('new_message', botMessage);
        }

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        let model = specificModel || settings['openwebui_model'] || process.env.OPENWEBUI_MODEL;
        if (!model) {
            try {
                const modelsRes = await fetch(`${openWebUiUrl}/api/models`, { headers });
                if (modelsRes.ok) {
                    const modelsData = await modelsRes.json();
                    if (modelsData.data && modelsData.data.length > 0) {
                        model = modelsData.data[0].id;
                    }
                }
            } catch (e) {
                console.warn('Could not auto-fetch models from openwebui');
            }
        }
        if (!model) model = 'llama3';

        const finalMessages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
            { role: 'user', content: cleanPrompt }
        ];
        console.log(`[${agentName}] Sending ${finalMessages.length} messages to model=${model}, roles=[${finalMessages.map(m=>m.role).join(',')}]`);

        const response = await fetch(`${openWebUiUrl}/api/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: model,
                messages: finalMessages,
                stream: true
            })
        });

        if (!response.ok || (response.headers.get('content-type') && response.headers.get('content-type').includes('text/html'))) {
            const errorText = await response.text();
            console.error('AI Error:', response.statusText, errorText);
            const errorMessage = `Error: ${response.statusText}\n\`\`\`json\n${errorText}\n\`\`\``;
            const updatedBotMsg = await db.saveMessage(agentName.toLowerCase(), agentName, errorMessage, recipientId, 'text', null, null, triggerMessage.id, channelId);
            updatedBotMsg.id = botMessage.id;
            if (!recipientId) {
                io.to(`channel_${channelId}`).emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
            } else {
                io.to(recipientId).emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
                socket.emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
            }
        } else {
            let fullResponse = '';
            const reader = response.body;
            const decoder = new TextDecoder();
            let firstChunkChecked = false;
            let rawAccumulator = '';

            for await (const chunk of reader) {
                const text = decoder.decode(chunk, { stream: true });
                rawAccumulator += text;

                // Check the very first chunk for HTML or JSON error responses
                if (!firstChunkChecked) {
                    firstChunkChecked = true;
                    const trimmed = rawAccumulator.trim();
                    if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
                        console.error(`[${agentName}] Received HTML instead of SSE stream`);
                        const errorMsg = `⚠️ AI server returned an error page. The model "${model}" may not be loaded in LM Studio.`;
                        await db.editMessage(botMessage.id, errorMsg);
                        io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
                        return;
                    }
                    if (trimmed.startsWith('{')) {
                        try {
                            const errObj = JSON.parse(trimmed);
                            if (errObj.error || errObj.detail) {
                                const errText = errObj.error?.message || errObj.detail || JSON.stringify(errObj);
                                console.error(`[${agentName}] API error:`, errText);
                                const errorMsg = `⚠️ AI Error: ${errText}`;
                                await db.editMessage(botMessage.id, errorMsg);
                                io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
                                return;
                            }
                        } catch(e) { /* not complete JSON yet, continue as SSE */ }
                    }
                }

                const lines = text.split('\n').filter(line => line.trim().startsWith('data:'));

                for (const line of lines) {
                    const jsonStr = line.replace(/^data:\s*/, '').trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(jsonStr);

                        // Check for inline error from OpenWebUI
                        if (parsed.error) {
                            const errText = parsed.error?.message || parsed.error;
                            console.error(`[${agentName}] Stream error:`, errText);
                            const errorMsg = `⚠️ AI Error: ${errText}`;
                            await db.editMessage(botMessage.id, errorMsg);
                            io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
                            return;
                        }

                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
                        
                        if (reasoning) {
                            if (!fullResponse.includes('<think>')) {
                                fullResponse += '<think>\n';
                            }
                            fullResponse += reasoning;
                            io.emit('mimir_stream', { messageId: botMessage.id, chunk: reasoning, fullContent: fullResponse });
                        }

                        if (delta) {
                            if (fullResponse.includes('<think>') && !fullResponse.includes('</think>')) {
                                fullResponse += '\n</think>\n\n';
                            }
                            fullResponse += delta;
                            io.emit('mimir_stream', { messageId: botMessage.id, chunk: delta, fullContent: fullResponse });
                        }
                    } catch (e) {
                        console.warn(`[${agentName}] Failed to parse SSE chunk:`, jsonStr.substring(0, 200));
                    }
                }
            }

            if (fullResponse) {
                await db.editMessage(botMessage.id, fullResponse);
                io.emit('message_edited', { messageId: botMessage.id, newContent: fullResponse });
                
                if (mentionedSandboxId && activeSandboxes[channelId] && activeSandboxes[channelId][mentionedSandboxId]) {
                    const codeBlockMatch = fullResponse.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        const extractedCode = codeBlockMatch[1];
                        activeSandboxes[channelId][mentionedSandboxId].code = extractedCode;
                        io.emit('sandbox:update', { channelId, sandboxId: mentionedSandboxId, code: extractedCode });
                    }
                }
                
            } else {
                const fallback = '⚠️ I got an empty response. The model may not be loaded in LM Studio.';
                await db.editMessage(botMessage.id, fallback);
                io.emit('message_edited', { messageId: botMessage.id, newContent: fallback });
            }
        }
    } catch (err) {
        console.error('AI Request failed', err);
        io.to(`channel_${channelId}`).emit('new_message', await db.saveMessage(agentName.toLowerCase(), agentName, `Error: Could not reach AI server.`, recipientId, 'text', null, null, triggerMessage.id, channelId));
    }
}
// --- @image Generation ---
async function handleImageMessage(socket, triggerMessage, channelId, recipientId) {
    const settings = await db.getSettings();
    const comfyUiUrl = settings['comfyui_url'] || process.env.COMFYUI_URL || 'http://localhost:8188';
    const userPrompt = triggerMessage.content.replace(/^@image\s*/i, '').trim();
    if (!userPrompt) return;

    try {
        // Send generating indicator
        const botMessage = await db.saveMessage('mimir', 'Image Gen', `Generating image for: "${userPrompt}"...`, recipientId, 'text', null, null, triggerMessage.id, channelId);

        if (!recipientId) {
            io.to(`channel_${channelId}`).emit('new_message', botMessage);
        } else {
            io.to(recipientId).emit('new_message', botMessage);
            socket.emit('new_message', botMessage);
        }

        const fs = require('fs');
        const path = require('path');
        const workflowPath = path.join(process.cwd(), 'comfy_workflow.json');

        let workflow;
        if (fs.existsSync(workflowPath)) {
            workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

            // Optimize prompt for Ideogram v4 safety filters
            const optimizedPrompt = `A safe for work, family friendly depiction of: ${userPrompt}`;

            // Randomize seed if node 98:18 exists
            if (workflow["98:18"] && workflow["98:18"].inputs) {
                workflow["98:18"].inputs.noise_seed = Math.floor(Math.random() * 1000000000000000);
            }
            // Inject prompt
            if (workflow["98:24"] && workflow["98:24"].inputs) {
                workflow["98:24"].inputs.text = optimizedPrompt;
            } else {
                for (const key in workflow) {
                    if (workflow[key].class_type === 'CLIPTextEncode' && typeof workflow[key].inputs.text === 'string' && !workflow[key].inputs.text.includes('watermark')) {
                        workflow[key].inputs.text = optimizedPrompt;
                    }
                }
            }
        } else {
            workflow = {
                "3": { "class_type": "KSampler", "inputs": { "seed": Math.floor(Math.random() * 1000000000), "steps": 20, "cfg": 8, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
                "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" } },
                "5": { "class_type": "EmptyLatentImage", "inputs": { "batch_size": 1, "height": 512, "width": 512 } },
                "6": { "class_type": "CLIPTextEncode", "inputs": { "text": userPrompt, "clip": ["4", 1] } },
                "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "watermark, text, bad quality", "clip": ["4", 1] } },
                "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
                "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "jellychat", "images": ["8", 0] } }
            };
        }

        const res = await fetch(`${comfyUiUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow })
        });

        if (res.ok) {
            const data = await res.json();
            const promptId = data.prompt_id;

            // Poll for completion (up to 10 minutes)
            let generatedImageName = null;
            for (let i = 0; i < 300; i++) {
                await new Promise(r => setTimeout(r, 2000));

                // Intermittent status updates
                if (i % 15 === 0 && i > 0) {
                    const minutes = Math.floor((i * 2) / 60);
                    const waitMsg = `Generating image for: "${userPrompt}"... (still working, ${minutes}m elapsed)`;
                    await db.editMessage(botMessage.id, waitMsg);
                    io.emit('message_edited', { messageId: botMessage.id, newContent: waitMsg });
                }

                const histRes = await fetch(`${comfyUiUrl}/history/${promptId}`);
                if (histRes.ok) {
                    const histData = await histRes.json();
                    if (histData[promptId] && histData[promptId].outputs) {
                        const outputs = histData[promptId].outputs;
                        for (const key in outputs) {
                            if (outputs[key].images && outputs[key].images.length > 0) {
                                generatedImageName = outputs[key].images[0].filename;
                                break;
                            }
                        }
                        if (generatedImageName) break;
                    }
                }
            }

            if (generatedImageName) {
                const imgRes = await fetch(`${comfyUiUrl}/view?filename=${generatedImageName}`);
                if (imgRes.ok) {
                    const buffer = await imgRes.arrayBuffer();
                    const localFilename = `img_${Date.now()}.png`;
                    fs.writeFileSync(path.join(__dirname, 'uploads', localFilename), Buffer.from(buffer));
                    const attachmentUrl = `/uploads/${localFilename}`;

                    await db.editMessageAttachment(botMessage.id, 'image', attachmentUrl, localFilename, '');
                    const successMessage = { ...botMessage, type: 'image', attachmentUrl, fileName: localFilename, content: '' };
                    io.emit('message_edited', { messageId: botMessage.id, newContent: '', type: 'image', attachmentUrl, fileName: localFilename });
                } else {
                    const errorMsg = 'dY " Failed to download generated image.';
                    await db.editMessage(botMessage.id, errorMsg);
                    io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
                }
            } else {
                const errorMsg = 'dY " Image generation timed out.';
                await db.editMessage(botMessage.id, errorMsg);
                io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
            }
        } else {
            const errorMsg = 'dY " ComfyUI rejected the prompt. Check settings.';
            await db.editMessage(botMessage.id, errorMsg);
            io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
        }
    } catch (err) {
        console.error('Image Gen Request failed', err);
        const errorMsg = 'dY " Could not reach ComfyUI server.';
        await db.editMessage(botMessage.id, errorMsg);
        io.emit('message_edited', { messageId: botMessage.id, newContent: errorMsg });
    }
}

// --- Game Save State Endpoints ---
app.post('/api/saves', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    const { romHash, romName, saveData } = req.body;
    if (!romHash || !saveData) return res.status(400).json({ error: 'Missing romHash or saveData' });

    try {
        await db.saveGameState(cleanIp, romHash, romName || 'Unknown', saveData);
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving game state', err);
        res.status(500).json({ error: 'Failed to save game state' });
    }
});

app.get('/api/saves/:romHash', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    try {
        const save = await db.getGameState(cleanIp, req.params.romHash);
        if (save) {
            res.json(save);
        } else {
            res.status(404).json({ error: 'No save found' });
        }
    } catch (err) {
        console.error('Error fetching game state', err);
        res.status(500).json({ error: 'Failed to fetch game state' });
    }
});

// --- Settings Endpoints ---
app.get('/api/settings', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    try {
        const settings = await db.getSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

app.post('/api/settings', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
        await db.saveSetting(key, value);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save setting' });
    }
});

app.get('/api/models', async (req, res) => {
    if (!await isRequesterAdmin(req)) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const settings = await db.getSettings();
        const openWebUiUrl = settings['openwebui_url'] || process.env.OPENWEBUI_URL || 'http://localhost:3000';
        const apiKey = settings['openwebui_api_key'] || process.env.OPENWEBUI_API_KEY;
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const modelsRes = await fetch(`${openWebUiUrl}/api/models`, { headers });
        if (!modelsRes.ok) throw new Error('Failed to fetch from OpenWebUI');
        const modelsData = await modelsRes.json();
        res.json(modelsData);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch models' });
    }
});

// --- Channel Summary Endpoint ---
app.get('/api/channel-summary', async (req, res) => {
    try {
        const lastMessages = await db.getLastMessagePerChannel();
        const counts = await db.getChannelMessageCounts();
        res.json({ lastMessages, counts });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch channel summary' });
    }
});

app.post('/api/stickers/upload', upload.single('sticker'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No sticker uploaded.' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
});

app.get('/api/channels', async (req, res) => {
    try {
        const channels = await db.getChannels();
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.post('/api/channels', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { id, name, description, type } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'Missing id or name' });
        await db.createChannel(id, name, description, type || 'text');
        const channels = await db.getChannels();
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

app.put('/api/channels/:id', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { name, description, type } = req.body;
        if (!name) return res.status(400).json({ error: 'Missing name' });
        await db.editChannel(req.params.id, name, description, type || 'text');
        const channels = await db.getChannels();
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: 'Failed to edit channel' });
    }
});

app.delete('/api/channels/:id/purge', async (req, res) => {
    try {
        const channelId = req.params.id;
        await db.purgeChannelMessages(channelId);
        io.emit('channel_purged', channelId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error purging channel', err);
        res.status(500).json({ error: 'Failed to purge channel' });
    }
});

app.delete('/api/channels/:id', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    try {
        await db.deleteChannel(req.params.id);
        const channels = await db.getChannels();
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

app.post('/api/taildrop', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const { peerIp } = req.body;
    if (!peerIp) {
        return res.status(400).json({ error: 'Peer IP required' });
    }

    try {
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        console.log(`[Taildrop] Received file ${req.file.originalname} (${req.file.size} bytes) intended for ${peerIp}`);

        // Rename the temp file to original name so tailscale file cp uses it
        const tempPath = req.file.path;
        const originalNamePath = path.join(path.dirname(tempPath), req.file.originalname);

        fs.renameSync(tempPath, originalNamePath);

        const cmd = `tailscale file cp "${originalNamePath}" ${peerIp}:`;
        console.log(`[Taildrop] Running command: ${cmd}`);

        exec(cmd, (error, stdout, stderr) => {
            console.log(`[Taildrop] cp finished. Error: ${error}, stdout: ${stdout}, stderr: ${stderr}`);
            // Let's NOT delete it immediately. Tailscale might need time to read it!
            setTimeout(() => {
                fs.unlink(originalNamePath, () => { });
            }, 60000); // 1 minute delay

            if (error) {
                console.error(`Taildrop error: ${error.message}`);
                return res.status(500).json({ error: 'Failed to send via Taildrop' });
            }
            res.json({ success: true });
        });
    } catch (e) {
        console.error(`[Taildrop] Exception:`, e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');

    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    const senderName = tailscale.getDeviceNameByIp(cleanIp);
    const attachmentUrl = `/uploads/${req.file.filename}`;
    const recipientId = req.body.recipientId || null;
    const replyToId = req.body.replyToId || null;
    const fileName = req.file.originalname;

    // Determine if it's an image, video, audio or general file
    let messageType = 'file';
    if (req.file.mimetype.startsWith('image/')) {
        messageType = 'image';
    } else if (fileName === 'voicememo.webm' || req.file.mimetype.startsWith('audio/') || fileName.endsWith('.m4a') || fileName.endsWith('.wav') || fileName.endsWith('.mp3')) {
        messageType = 'audio';
    } else if (req.file.mimetype.startsWith('video/') || fileName.endsWith('.mp4') || fileName.endsWith('.webm') || fileName.endsWith('.mov')) {
        messageType = 'video';
    }

    try {
        const savedMessage = await db.saveMessage(cleanIp, senderName, '', recipientId, messageType, attachmentUrl, fileName, replyToId);

        if (!recipientId) {
            io.emit('new_message', savedMessage);
        } else {
            io.to(recipientId).emit('new_message', savedMessage);
            io.to(cleanIp).emit('new_message', savedMessage);
        }

        sendPushNotification(savedMessage, recipientId);

        res.json(savedMessage);
    } catch (err) {
        console.error('Error saving file message', err);
        res.status(500).json({ error: 'Failed to save message' });
    }
});

// Nodemailer setup
let transporter = null;
if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
} else {
    console.warn('SMTP_HOST not configured. Email notifications are disabled.');
}

// Helper function to send push notifications
async function sendPushNotification(message, recipientId) {
    try {
        const payload = JSON.stringify({
            title: recipientId ? message.senderName : `Global: ${message.senderName}`,
            body: message.type === 'image' ? 'Sent an image' : message.type === 'audio' ? 'Sent a voice memo' : message.type === 'file' ? `Sent a file: ${message.fileName}` : message.content,
            icon: '/icon-192.png'
        });

        if (recipientId) {
            const sub = await db.getSubscription(recipientId);
            if (!connectedIps.has(recipientId)) {
                if (sub) {
                    webpush.sendNotification(sub, payload).catch(err => console.error('Push error for', recipientId, err));
                }
                sendEmailFallback(recipientId, payload);
            }
        } else {
            const subs = await db.getAllSubscriptions();
            for (const { ip, subscription } of subs) {
                if (ip !== message.senderId && !connectedIps.has(ip)) {
                    webpush.sendNotification(subscription, payload).catch(err => console.error('Push error for global', err));
                    sendEmailFallback(ip, payload);
                }
            }
        }
    } catch (err) {
        console.error('Error sending push', err);
    }
}
async function sendEmailFallback(ip, payloadString) {
    if (!transporter) {
        console.log(`Email fallback skipped for ${ip} - SMTP not configured.`);
        return;
    }
    try {
        const payload = JSON.parse(payloadString);
        const info = await transporter.sendMail({
            from: '"JellyChat" <noreply@jellychat.local>',
            to: `user-${ip.replace(/\./g, '-')}@example.com`, // In a real app, map IP/profile to actual email address
            subject: payload.title,
            text: payload.body,
        });
        console.log(`Email fallback sent for ${ip}.`);
    } catch (err) {
        console.error('Error sending fallback email', err);
    }
}

app.post('/api/subscribe', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    const subscription = req.body;
    try {
        await db.saveSubscription(cleanIp, subscription);
        res.status(201).json({});
    } catch (err) {
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

app.get('/api/vapidPublicKey', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});


app.get('/api/profiles/keys', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    try {
        const profileId = await db.getDeviceAssignment(cleanIp);
        if (!profileId) return res.status(404).json({ error: 'No profile assigned' });

        const keys = await db.getProfileKeys(profileId);
        if (keys && keys.publicKey && keys.privateKey) {
            res.json(keys);
        } else {
            res.status(404).json({ error: 'No keys found for profile' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

app.post('/api/profiles/keys', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }
    const { publicKey, privateKey } = req.body;

    if (!publicKey || !privateKey) return res.status(400).json({ error: 'Missing keys' });

    try {
        const profileId = await db.getDeviceAssignment(cleanIp);
        if (profileId) {
            await db.setProfileKeys(profileId, JSON.stringify(publicKey), JSON.stringify(privateKey));
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'No profile assigned to this IP' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to save keys' });
    }
});

app.post('/api/keys', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    const jwk = req.body;
    try {
        await db.savePublicKey(cleanIp, jwk);
        res.status(201).json({});
    } catch (err) {
        res.status(500).json({ error: 'Failed to save public key' });
    }
});

app.get('/api/roms', (req, res) => {
    try {
        const getFilesRecursively = (dir, fileList = []) => {
            if (!fs.existsSync(dir)) return fileList;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file.startsWith('.')) continue;
                const filePath = path.join(dir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    getFilesRecursively(filePath, fileList);
                } else {
                    fileList.push(filePath);
                }
            }
            return fileList;
        };

        const allFiles = getFilesRecursively(romsDir);
        const roms = allFiles.map(filePath => {
            const f = path.basename(filePath);
            const relativePath = path.relative(romsDir, filePath).replace(/\\/g, '/');
            const ext = path.extname(f).toLowerCase();
            let core = 'unknown';
            if (['.nes'].includes(ext)) core = 'nes';
            else if (['.sfc', '.smc'].includes(ext)) core = 'snes';
            else if (['.gba'].includes(ext)) core = 'gba';
            else if (['.gb', '.gbc'].includes(ext)) core = 'gb';
            else if (['.z64', '.n64', '.v64'].includes(ext)) core = 'n64';
            else if (['.md', '.smd', '.gen'].includes(ext)) core = 'segaMD';
            else if (['.iso', '.cso'].includes(ext)) core = 'psp';
            else if (['.nds'].includes(ext)) core = 'nds';

            return {
                name: f,
                url: `/roms/${encodeURIComponent(relativePath)}`,
                core: core,
                size: fs.statSync(filePath).size
            };
        }).filter(r => r.core !== 'unknown');
        res.json(roms);
    } catch (err) {
        console.error('Error reading roms dir:', err);
        res.status(500).json({ error: 'Failed to read roms' });
    }
});

app.get('/api/keys/:ip', async (req, res) => {
    const ip = req.params.ip;
    try {
        // 1. Try to get profile-synced public key
        const profileId = await db.getDeviceAssignment(ip);
        if (profileId) {
            const keys = await db.getProfileKeys(profileId);
            if (keys && keys.publicKey) {
                return res.json(JSON.parse(keys.publicKey));
            }
        }

        // 2. Fallback to old IP-based public key
        const jwk = await db.getPublicKey(ip);
        if (jwk) {
            res.json(jwk);
        } else {
            res.status(404).json({ error: 'Key not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve public key' });
    }
});

app.post('/api/ai/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        // Try the env variable, then the IP from the user's screenshot, then localhost fallback
        const comfyUrl = process.env.COMFYUI_URL || 'http://192.168.4.38:8188';

        // Load the JSON workflow the user provided
        const workflowPath = path.join(process.cwd(), 'comfy_workflow.json');
        let comfyPrompt = {};
        if (fs.existsSync(workflowPath)) {
            comfyPrompt = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

            // Optimize prompt for Ideogram v4 safety filters
            const optimizedPrompt = `A safe for work, family friendly depiction of: ${prompt}`;

            // Randomize seed if node 98:18 exists
            if (comfyPrompt["98:18"] && comfyPrompt["98:18"].inputs) {
                comfyPrompt["98:18"].inputs.noise_seed = Math.floor(Math.random() * 1000000000000000);
            }
            // Inject the user's prompt into the specific Ideogram node
            if (comfyPrompt["98:24"] && comfyPrompt["98:24"].inputs) {
                comfyPrompt["98:24"].inputs.text = optimizedPrompt;
            } else {
                // Fallback text node injection if IDs change
                for (const key in comfyPrompt) {
                    if (comfyPrompt[key].class_type === 'CLIPTextEncode' && typeof comfyPrompt[key].inputs.text === 'string' && !comfyPrompt[key].inputs.text.includes('watermark')) {
                        comfyPrompt[key].inputs.text = optimizedPrompt;
                    }
                }
            }
        } else {
            comfyPrompt = {
                "3": { "class_type": "KSampler", "inputs": { "seed": Math.floor(Math.random() * 1000000000), "steps": 20, "cfg": 8, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
                "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" } },
                "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
                "6": { "class_type": "CLIPTextEncode", "inputs": { "text": prompt, "clip": ["4", 1] } },
                "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "text, watermark, ugly, blurry", "clip": ["4", 1] } },
                "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
                "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "jellychat", "images": ["8", 0] } }
            };
        }

        const submitRes = await fetch(`${comfyUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: comfyPrompt })
        });

        if (!submitRes.ok) throw new Error(`ComfyUI Error: ${submitRes.status}`);

        const promptData = await submitRes.json();
        const promptId = promptData.prompt_id;

        let historyData = {};
        let retries = 0;
        while (retries < 600) {
            await new Promise(r => setTimeout(r, 1000));
            const histRes = await fetch(`${comfyUrl}/history/${promptId}`);
            historyData = await histRes.json();
            if (historyData[promptId]) break;
            retries++;
        }

        if (!historyData[promptId]) throw new Error('ComfyUI timeout');

        const outputs = historyData[promptId].outputs;
        let filename = '';
        for (const key in outputs) {
            if (outputs[key].images && outputs[key].images.length > 0) {
                filename = outputs[key].images[0].filename;
                break;
            }
        }

        if (!filename) throw new Error('No image generated by ComfyUI');

        const imgRes = await fetch(`${comfyUrl}/view?filename=${filename}&type=output`);
        const buffer = await imgRes.arrayBuffer();
        const finalFilename = `sticker_${Date.now()}.png`;
        const filePath = path.join(uploadsDir, finalFilename);
        fs.writeFileSync(filePath, Buffer.from(buffer));

        res.json({ url: `/uploads/${finalFilename}` });
    } catch (err) {
        console.error('Error generating AI sticker:', err);
        res.status(500).json({ error: 'Failed to generate AI sticker' });
    }
});

async function isRequesterAdmin(req) {
    if (req.webUser) return false; // Web users are never admin
    const rawIp = getClientId(req);
    let cleanIp = rawIp;

    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        return true;
    }
    const selfIps = tailscale.getSelfIps();
    if (selfIps.includes(cleanIp)) {
        return true;
    }

    const assignments = await db.getDeviceAssignments();
    const assignment = assignments.find(a => a.ip === cleanIp);
    if (!assignment) return false;

    const profiles = await db.getProfiles();
    const profile = profiles.find(p => p.id === assignment.profileId);
    return profile ? profile.isAdmin === 1 : false;
}

app.get('/api/auth/status', async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');

    let isHost = false;
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        isHost = true;
    } else {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.includes(cleanIp)) isHost = true;
    }

    const isAdmin = await isRequesterAdmin(req);
    const magicDns = tailscale.getSelfDnsName();
    res.json({ isHost, isAdmin, magicDns });
});

app.get('/api/profiles', async (req, res) => {
    try {
        const profiles = await db.getProfiles();
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profiles' });
    }
});

app.post('/api/profiles/self', upload.single('avatar'), async (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    try {
        const name = req.body.name || tailscale.getDeviceNameByIp(cleanIp) || cleanIp;
        let avatarUrl = req.body.avatarUrl || null;

        if (req.file) {
            avatarUrl = `/uploads/${req.file.filename}`;
        }

        let profileId = await db.getDeviceAssignment(cleanIp);
        let isAdmin = 0;

        if (!profileId) {
            profileId = `user_${cleanIp.replace(/[\.\:]/g, '_')}`;
            await db.assignDevice(cleanIp, profileId);
        } else {
            const existingProfile = await db.getProfileById(profileId);
            if (existingProfile) {
                isAdmin = existingProfile.isAdmin || 0;
                if (!avatarUrl && !req.file && !req.body.clearAvatar) {
                    avatarUrl = existingProfile.avatar;
                }
            }
        }

        if (req.body.clearAvatar) {
            avatarUrl = null;
        }

        await db.createProfile(profileId, name, avatarUrl, isAdmin);

        const updatedProfiles = await db.getProfiles();
        const updatedAssignments = await db.getDeviceAssignments();
        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });

        res.status(200).json({ id: profileId, name, avatar: avatarUrl, isAdmin });
    } catch (err) {
        console.error('Error updating self profile', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

app.post('/api/profiles', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

    const { id, name, avatar, isAdmin } = req.body;
    try {
        await db.createProfile(id, name, avatar, isAdmin ? 1 : 0);
        res.status(201).json({ id, name, avatar, isAdmin });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create profile' });
    }
});

app.get('/api/assignments', async (req, res) => {
    try {
        const assignments = await db.getDeviceAssignments();
        res.json(assignments);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch assignments' });
    }
});

app.post('/api/assignments', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

    const { ip, profileId } = req.body;
    try {
        await db.assignDevice(ip, profileId);
        res.status(200).json({ success: true });

        // Broadcast profile assignment update
        const updatedProfiles = await db.getProfiles();
        const updatedAssignments = await db.getDeviceAssignments();
        // Dynamically update socket rooms for the affected IP
        io.sockets.sockets.forEach(s => {
            if (s.tailscaleIp === ip) {
                Array.from(s.rooms).forEach(room => {
                    if (room.startsWith('prof_')) s.leave(room);
                });
                s.join(profileId);
            }
        });

        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });

    } catch (err) {
        res.status(500).json({ error: 'Failed to assign device' });
    }
});

app.delete('/api/assignments/:ip', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

    try {
        await db.deleteAssignment(req.params.ip);
        res.status(200).json({ success: true });

        const updatedProfiles = await db.getProfiles();
        const updatedAssignments = await db.getDeviceAssignments();

        // Dynamically update socket rooms for the affected IP
        io.sockets.sockets.forEach(s => {
            if (s.tailscaleIp === req.params.ip) {
                Array.from(s.rooms).forEach(room => {
                    if (room.startsWith('prof_')) s.leave(room);
                });
            }
        });

        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete assignment' });
    }
});

app.delete('/api/profiles/:id', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

    try {
        await db.deleteProfile(req.params.id);
        res.status(200).json({ success: true });

        const updatedProfiles = await db.getProfiles();
        const updatedAssignments = await db.getDeviceAssignments();
        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete profile' });
    }
});

app.put('/api/profiles/:id/admin', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });
    try {
        await db.setProfileAdmin(req.params.id, req.body.isAdmin);
        res.status(200).json({ success: true });

        const updatedProfiles = await db.getProfiles();
        const updatedAssignments = await db.getDeviceAssignments();
        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to update admin status' });
    }
});


// Funnel Invite API
app.post('/api/funnel/generate', async (req, res) => {
    const rawIp = getClientId(req);
    // Authenticate creator
    const isAdmin = await isRequesterAdmin(req);
    if (!isAdmin) {
        return res.status(403).json({ error: 'Only admins can generate funnel links' });
    }

    const expiresInHours = parseInt(req.body.expiresIn) || 24;
    const authKey = req.body.authKey || ''; // Optional auth key to bundle
    const expiresAt = Date.now() + (expiresInHours * 60 * 60 * 1000);
    const token = require('crypto').randomUUID();
    const passcode = require('crypto').randomBytes(32).toString('hex');
    const creatorName = tailscale.getMe()?.name || 'Host';

    // Store in DB
    const db = require('./db');
    db.createFunnelInvite(token, passcode, expiresAt, creatorName)
        .then(() => {
            // Start Funnel in background
            try {
                const child_process = require('child_process');
                child_process.execSync('tailscale funnel --bg ' + (process.env.PORT || 4000));
            } catch (e) {
                console.error("Failed to start tailscale funnel", e);
            }

            const tsName = tailscale.getMe()?.dnsName || 'localhost';
            let url = `https://${tsName}/funnel-join?token=${token}`;
            if (authKey) {
                url += `&authkey=${encodeURIComponent(authKey)}`;
            }
            res.json({ url, passcode });
        })
        .catch((err) => {
            console.error("Failed to save funnel invite", err);
            return res.status(500).json({ error: 'Database error' });
        });
});

app.get('/funnel-join', (req, res) => {
    const token = req.query.token;
    const authkey = req.query.authkey;
    if (!token) return res.status(400).send('Missing token');

    // Redirect to home with funnel_token to prompt login modal
    let redirectUrl = `/?funnel_token=${encodeURIComponent(token)}`;
    if (authkey) {
        redirectUrl += `&authkey=${encodeURIComponent(authkey)}`;
    }
    res.redirect(redirectUrl);
});

app.post('/api/funnel/login', async (req, res) => {
    const { token, passcode, username } = req.body;
    if (!token || !passcode || !username) return res.status(400).json({ error: 'Missing fields' });

    const db = require('./db');
    try {
        const invite = await db.getFunnelInvite(token);
        if (!invite) return res.status(403).json({ error: 'Invalid invite link' });
        if (Date.now() > invite.expires_at) return res.status(403).json({ error: 'Invite link has expired' });
        if (invite.passcode !== passcode) return res.status(403).json({ error: 'Invalid passcode' });

        // Generate signed cookie payload containing username
        const payload = Buffer.from(JSON.stringify({ token, username })).toString('base64');
        res.cookie('funnel_auth', payload, { maxAge: invite.expires_at - Date.now(), httpOnly: true, secure: true });
        res.json({ success: true });
    } catch (err) {
        return res.status(403).json({ error: 'Invalid invite link' });
    }
});

app.post('/api/invite', async (req, res) => {
    const apiKey = process.env.TAILSCALE_API_KEY;
    const tailnet = process.env.TAILSCALE_TAILNET; // e.g., 'example.com' or 'alice@github'

    console.log("Using API Key:", apiKey ? `${apiKey.substring(0, 15)}...` : 'NONE');
    console.log("Using Tailnet:", tailnet);

    if (!apiKey || !tailnet) {
        return res.status(501).json({ error: 'TAILSCALE_API_KEY or TAILSCALE_TAILNET not configured. Please add them to your backend .env file.' });
    }

    try {
        const { expirySeconds = 86400, reusable = false, ephemeral = true } = req.body || {};
        const response = await fetch(`https://api.tailscale.com/api/v2/tailnet/${tailnet}/keys`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                capabilities: {
                    devices: {
                        create: {
                            reusable: Boolean(reusable),
                            ephemeral: Boolean(ephemeral),
                            preauthorized: true,
                            tags: ["tag:guest"]
                        }
                    }
                },
                expirySeconds: Number(expirySeconds)
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Tailscale API error: ${response.status} ${errBody}`);
        }

        const data = await response.json();
        res.json({ key: data.key, expires: data.expires });
    } catch (err) {
        console.error('Error generating invite:', err);
        res.status(500).json({ error: 'Failed to generate guest link' });
    }
});

app.get('/api/invite-script', (req, res) => {
    const { os, key, url } = req.query;
    if (!os || !key || !url) {
        return res.status(400).send("Missing parameters");
    }

    if (os === 'windows') {
        const batScript = `@echo off
echo Connecting to JellyChat Private Server...
echo.

tailscale --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Tailscale is not installed. Downloading...
    powershell -Command "Invoke-WebRequest -Uri 'https://tailscale.com/install.msi' -OutFile '%TEMP%\\tailscale.msi'"
    echo Installing Tailscale (this may prompt for Administrator permission)...
    msiexec /i "%TEMP%\\tailscale.msi" /quiet /norestart
    echo Waiting for installation to complete...
    timeout /t 5 /nobreak >nul
)

echo Authenticating device...
tailscale up --authkey=${key} --accept-routes

echo Opening JellyChat...
start ${url}
echo Done!
pause
`;
        res.setHeader('Content-disposition', 'attachment; filename=Join_JellyChat.bat');
        res.setHeader('Content-type', 'application/x-bat');
        return res.send(batScript);
    } else if (os === 'maclinux') {
        const shScript = `#!/bin/bash
echo "Connecting to JellyChat Private Server..."
echo ""

if ! command -v tailscale &> /dev/null; then
    echo "Tailscale is not installed. Installing..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "Authenticating device..."
sudo tailscale up --authkey="${key}" --accept-routes

echo "Opening JellyChat..."
if command -v xdg-open &> /dev/null; then
    xdg-open "${url}"
elif command -v open &> /dev/null; then
    open "${url}"
else
    echo "Please open your browser and navigate to: ${url}"
fi
`;
        res.setHeader('Content-disposition', 'attachment; filename=Join_JellyChat.sh');
        res.setHeader('Content-type', 'application/x-sh');
        return res.send(shScript);
    }

    res.status(400).send("Invalid OS");
});

app.get('/api/link-preview', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL required' });
    try {
        const preview = await getLinkPreview(url, {
            headers: {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });
        res.json(preview);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch preview' });
    }
});

app.get('/api/peers', (req, res) => {
    const peers = tailscale.getActivePeers();
    const enrichedPeers = peers.map(p => ({
        ...p,
        isJellychatOnline: connectedIps.has(p.ip) || p.ip === '127.0.0.1' || p.ip === '::1',
        activity: peerActivities.get(p.ip) || null,
        statusData: peerStatuses.get(p.ip) || null,
        steamInfo: peerSteamInfo.get(p.ip) || null
    }));
    res.json(enrichedPeers);
});

app.get('/api/me', (req, res) => {
    const rawIp = getClientId(req);
    let cleanIp = rawIp.replace(/^::ffff:/, '');

    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.length > 0) cleanIp = selfIps[0];
    }

    res.json({
        ip: cleanIp,
        deviceName: tailscale.getDeviceNameByIp(cleanIp)
    });
});

app.get('/api/download', (req, res) => {
    const fileUrl = req.query.url;
    const filename = req.query.filename || 'download';

    if (!fileUrl || typeof fileUrl !== 'string') {
        return res.status(400).send('Invalid file URL');
    }

    if (fileUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, 'uploads', fileUrl.replace('/uploads/', ''));
        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            const fileStream = fs.createReadStream(filePath);
            return fileStream.pipe(res);
        } else {
            return res.status(404).send('File not found');
        }
    }

    res.status(400).send('Only uploaded files can be downloaded directly');
});

app.get('/api/gifs', async (req, res) => {
    try {
        const query = req.query.q || '';
        const apiKey = process.env.TENOR_API_KEY || ''; // Needs a Tenor V2 key!

        if (!apiKey) {
            // Return mock data if no key is configured to prevent crashes
            return res.json({
                results: [
                    { id: 'mock1', content_description: 'Need API Key', media_formats: { tinygif: { url: 'https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif' }, gif: { url: 'https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif' } } },
                    { id: 'mock2', content_description: 'Configure .env', media_formats: { tinygif: { url: 'https://media.giphy.com/media/l41lFw057lAJQMwg0/giphy.gif' }, gif: { url: 'https://media.giphy.com/media/l41lFw057lAJQMwg0/giphy.gif' } } }
                ]
            });
        }

        const endpoint = query.trim() === ''
            ? `https://tenor.googleapis.com/v2/featured?key=${apiKey}&client_key=tailchat&limit=30`
            : `https://tenor.googleapis.com/v2/search?key=${apiKey}&client_key=tailchat&q=${encodeURIComponent(query)}&limit=30`;

        const response = await fetch(endpoint);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Error fetching gifs proxy', err);
        res.status(500).json({ error: 'Failed to fetch gifs' });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        if (query.trim() === '') return res.json([]);
        const results = await db.searchMessages(query);
        res.json(results);
    } catch (err) {
        console.error('Error searching messages', err);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

// Latency monitor loop
setInterval(() => {
    if (!io) return;
    const peers = Array.from(connectedIps);
    peers.forEach(ip => {
        if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return; // no need to ping local
        child_process.execFile('ping', ['-n', '1', '-w', '1000', ip], (err, stdout) => {
            if (err) return;
            const match = stdout.match(/time[=<](\d+)ms/i);
            if (match) {
                io.emit('latency_update', { ip, latency: parseInt(match[1]) });
            } else if (stdout.match(/time<1ms/i)) {
                io.emit('latency_update', { ip, latency: 1 });
            }
        });
    });
}, 5000);

// --- Ephemeral Message Pruner ---
setInterval(async () => {
    try {
        const prunedIds = await db.pruneExpiredMessages();
        if (prunedIds.length > 0) {
            io.emit('messages_pruned', prunedIds);
            console.log(`Pruned ${prunedIds.length} expired messages`);
        }
    } catch (err) {
        console.error('Error pruning expired messages', err);
    }
}, 30000);

let localActivity = null;

setInterval(() => {
    if (!io) return;
    child_process.exec('powershell -Command "Get-Process retroarch -ErrorAction SilentlyContinue | Select-Object -Property MainWindowTitle | ConvertTo-Json"', (err, stdout) => {
        if (err || !stdout.trim()) {
            if (localActivity !== null) {
                localActivity = null;
                io.emit('activity_update', { ip: tailscale.getSelfIps()[0] || '127.0.0.1', activity: null });
            }
            return;
        }
        try {
            const data = JSON.parse(stdout);
            const title = Array.isArray(data) ? data[0].MainWindowTitle : data.MainWindowTitle;
            if (title && title.includes('RetroArch')) {
                // Example format: RetroArch 1.15 - Snes9x - Super Mario World
                const parts = title.split(' - ');
                const gameName = parts.length > 2 ? parts[2] : (parts.length > 1 ? parts[1] : 'Unknown Game');

                const newActivity = { type: 'playing', details: `${gameName} (RetroArch)` };
                if (JSON.stringify(localActivity) !== JSON.stringify(newActivity)) {
                    localActivity = newActivity;
                    io.emit('activity_update', { ip: tailscale.getSelfIps()[0] || '127.0.0.1', activity: localActivity });
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    });
}, 5000);

io.on('connection', (socket) => {
    // When someone connects, if we have an activity, tell them immediately
    if (localActivity) {
        socket.emit('activity_update', { ip: tailscale.getSelfIps()[0] || '127.0.0.1', activity: localActivity });
    }
});

app.post('/api/retroarch/join', (req, res) => {
    const { peerIp } = req.body;
    if (!peerIp) return res.status(400).json({ error: 'Peer IP required' });

    const launch = () => {
        child_process.execFile('retroarch', ['--connect', peerIp], (err) => {
            if (err) console.error('Failed to launch retroarch', err);
        });
    };

    // Check if retroarch exists
    child_process.exec('retroarch --features', (err) => {
        if (err) {
            console.log('RetroArch not found, attempting to install via winget...');
            child_process.exec('winget install --id Libretro.RetroArch -e --accept-package-agreements --accept-source-agreements --silent', (installErr) => {
                if (installErr) {
                    console.error('Failed to install RetroArch', installErr);
                    return res.status(500).json({ error: 'Failed to install RetroArch. Please install manually.' });
                }
                launch();
                res.json({ success: true, installed: true });
            });
        } else {
            launch();
            res.json({ success: true, installed: false });
        }
    });
});

// --- Game Server Browser with Steam Integration ---
const { GameDig } = require('gamedig');
const dgram = require('dgram');

let discoveredGameServers = [];
const lanGameServers = new Map();

// --- Steam Integration ---
let steamInfo = { installed: false, path: null, steamId: null, personaName: null, installedApps: [] };
const peerSteamInfo = new Map(); // ip -> { personaName, steamId, installedApps[] }

// Steam App ID -> { gamedigType, displayName, defaultPort, steamAppId, joinPrefix }
const STEAM_APP_MAP = {
    '4000': { gamedigType: 'garrysmod', displayName: "Garry's Mod", defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '730': { gamedigType: 'counterstrike2', displayName: 'Counter-Strike 2', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '440': { gamedigType: 'teamfortress2', displayName: 'Team Fortress 2', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '252490': { gamedigType: 'rust', displayName: 'Rust', defaultPort: 28015, joinPrefix: 'steam://connect/' },
    '892970': { gamedigType: 'valheim', displayName: 'Valheim', defaultPort: 2456, joinPrefix: 'steam://connect/' },
    '346110': { gamedigType: 'ase', displayName: 'ARK: Survival Evolved', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '2399830': { gamedigType: 'asa', displayName: 'ARK: Survival Ascended', defaultPort: 7777, joinPrefix: null },
    '108600': { gamedigType: 'projectzomboid', displayName: 'Project Zomboid', defaultPort: 16261, joinPrefix: null },
    '322330': { gamedigType: 'dst', displayName: "Don't Starve Together", defaultPort: 10999, joinPrefix: null },
    '242760': { gamedigType: 'theforest', displayName: 'The Forest', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '1326470': { gamedigType: null, displayName: 'Sons of the Forest', defaultPort: null, joinPrefix: null },
    '304930': { gamedigType: 'unturned', displayName: 'Unturned', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '221100': { gamedigType: 'dayz', displayName: 'DayZ', defaultPort: 2302, joinPrefix: 'steam://connect/' },
    '107410': { gamedigType: 'arma3', displayName: 'ARMA 3', defaultPort: 2302, joinPrefix: 'steam://connect/' },
    '526870': { gamedigType: 'satisfactory', displayName: 'Satisfactory', defaultPort: 7777, joinPrefix: null },
    '427520': { gamedigType: 'factorio', displayName: 'Factorio', defaultPort: 34197, joinPrefix: null },
    '1604030': { gamedigType: 'vrising', displayName: 'V Rising', defaultPort: 27015, joinPrefix: null },
    '602960': { gamedigType: 'barotrauma', displayName: 'Barotrauma', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '629760': { gamedigType: 'mordhau', displayName: 'Mordhau', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '686810': { gamedigType: 'hll', displayName: 'Hell Let Loose', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '284160': { gamedigType: 'beammp', displayName: 'BeamMP', defaultPort: 30814, joinPrefix: null },
    '393380': { gamedigType: 'squad', displayName: 'Squad', defaultPort: 7787, joinPrefix: null },
    '581320': { gamedigType: 'insurgencysandstorm', displayName: 'Insurgency: Sandstorm', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '440900': { gamedigType: 'conanexiles', displayName: 'Conan Exiles', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '1172620': { gamedigType: 'enshrouded', displayName: 'Enshrouded', defaultPort: 15636, joinPrefix: null },
    '1963720': { gamedigType: 'corekeeper', displayName: 'Core Keeper', defaultPort: 1234, joinPrefix: null },
    '211820': { gamedigType: 'starbound', displayName: 'Starbound', defaultPort: 21025, joinPrefix: null },
    '251570': { gamedigType: 'sdtd', displayName: '7 Days to Die', defaultPort: 26900, joinPrefix: 'steam://connect/' },
    '1066780': { gamedigType: 'l4d2', displayName: 'Left 4 Dead 2', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '222880': { gamedigType: 'insurgency', displayName: 'Insurgency', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '1623730': { gamedigType: 'palworld', displayName: 'Palworld', defaultPort: 8212, joinPrefix: null },
    '244210': { gamedigType: 'assettocorsa', displayName: 'Assetto Corsa', defaultPort: 9610, joinPrefix: null },
    '284160': { gamedigType: 'beammp', displayName: 'BeamNG.drive (BeamMP)', defaultPort: 30814, joinPrefix: null },
    '105600': { gamedigType: 'terrariatshock', displayName: 'Terraria', defaultPort: 7777, joinPrefix: null },
    '10': { gamedigType: 'counterstrike16', displayName: 'Counter-Strike 1.6', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '240': { gamedigType: 'css', displayName: 'Counter-Strike: Source', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '550': { gamedigType: 'l4d2', displayName: 'Left 4 Dead 2', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '17710': { gamedigType: 'svencoop', displayName: 'Sven Co-op', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '674940': { gamedigType: null, displayName: 'Stick Fight: The Game', defaultPort: null, joinPrefix: null },
    '413150': { gamedigType: null, displayName: 'Stardew Valley', defaultPort: null, joinPrefix: null },
    // --- Additional Games ---
    '1962700': { gamedigType: null, displayName: 'Subnautica 2', defaultPort: null, joinPrefix: null },
    '387990': { gamedigType: null, displayName: 'Scrap Mechanic', defaultPort: null, joinPrefix: null },
    '244850': { gamedigType: 'spaceengineers', displayName: 'Space Engineers', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '394360': { gamedigType: 'hof', displayName: 'Hearts of Iron IV', defaultPort: null, joinPrefix: null },
    '236850': { gamedigType: 'eco', displayName: 'Eco', defaultPort: 3000, joinPrefix: null },
    '834910': { gamedigType: 'theisle', displayName: 'The Isle', defaultPort: 7707, joinPrefix: null },
    '1928980': { gamedigType: 'soulmask', displayName: 'Soulmask', defaultPort: 8777, joinPrefix: null },
    '1149460': { gamedigType: 'icarus', displayName: 'Icarus', defaultPort: 27015, joinPrefix: 'steam://connect/' },
    '393420': { gamedigType: null, displayName: 'Tabletop Simulator', defaultPort: null, joinPrefix: null },
    '945360': { gamedigType: null, displayName: 'Among Us', defaultPort: null, joinPrefix: null },
    '1100600': { gamedigType: null, displayName: 'Lethal Company', defaultPort: null, joinPrefix: null },
    '2881650': { gamedigType: null, displayName: 'Content Warning', defaultPort: null, joinPrefix: null },
    '739630': { gamedigType: null, displayName: 'Phasmophobia', defaultPort: null, joinPrefix: null },
    '548430': { gamedigType: null, displayName: 'Deep Rock Galactic', defaultPort: null, joinPrefix: null },
    '275850': { gamedigType: null, displayName: "No Man's Sky", defaultPort: null, joinPrefix: null },
    '1063730': { gamedigType: null, displayName: 'New World', defaultPort: null, joinPrefix: null },
    '892970': { gamedigType: 'valheim', displayName: 'Valheim', defaultPort: 2456, joinPrefix: 'steam://connect/' },
    '1517290': { gamedigType: null, displayName: 'Raft', defaultPort: null, joinPrefix: null },
    '962130': { gamedigType: null, displayName: 'Grounded', defaultPort: null, joinPrefix: null },
    '1369320': { gamedigType: null, displayName: 'Devour', defaultPort: null, joinPrefix: null },
    '3164500': { gamedigType: null, displayName: 'Schedule I', defaultPort: null, joinPrefix: null },
    '3716600': { gamedigType: null, displayName: 'Mage Arena', defaultPort: null, joinPrefix: null },
};

// Simple VDF parser (handles Valve's key-value format)
function parseVdf(text) {
    const result = {};
    const stack = [result];
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '{') continue;
        if (trimmed === '}') { stack.pop(); continue; }

        // Match "key" "value" pairs
        const kvMatch = trimmed.match(/^"([^"]*)"[\s\t]+"([^"]*)"$/);
        if (kvMatch) {
            stack[stack.length - 1][kvMatch[1]] = kvMatch[2];
            continue;
        }

        // Match section headers: "key"
        const secMatch = trimmed.match(/^"([^"]*)"$/);
        if (secMatch) {
            const newObj = {};
            stack[stack.length - 1][secMatch[1]] = newObj;
            stack.push(newObj);
        }
    }
    return result;
}

function detectSteam() {
    try {
        // Try to read Steam install path from registry
        const regResult = child_process.execSync(
            'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
            { encoding: 'utf8', timeout: 5000 }
        );
        const pathMatch = regResult.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (!pathMatch) return;

        const steamPath = pathMatch[1].trim();
        if (!fs.existsSync(steamPath)) return;

        steamInfo.installed = true;
        steamInfo.path = steamPath;
        console.log(`[Steam] Detected installation at: ${steamPath}`);

        // Read user info from loginusers.vdf
        const loginUsersPath = path.join(steamPath, 'config', 'loginusers.vdf');
        if (fs.existsSync(loginUsersPath)) {
            const loginData = parseVdf(fs.readFileSync(loginUsersPath, 'utf8'));
            const users = loginData.users || {};
            for (const [steamId, userData] of Object.entries(users)) {
                if (userData.MostRecent === '1') {
                    steamInfo.steamId = steamId;
                    steamInfo.personaName = userData.PersonaName;
                    console.log(`[Steam] Active user: ${userData.PersonaName} (${steamId})`);
                    break;
                }
            }
        }

        // Read installed apps from libraryfolders.vdf
        const libFoldersPath = path.join(steamPath, 'config', 'libraryfolders.vdf');
        if (fs.existsSync(libFoldersPath)) {
            const libData = parseVdf(fs.readFileSync(libFoldersPath, 'utf8'));
            const folders = libData.libraryfolders || {};
            const installedApps = new Set();

            for (const [, folderData] of Object.entries(folders)) {
                if (folderData && folderData.apps) {
                    for (const appId of Object.keys(folderData.apps)) {
                        installedApps.add(appId);
                    }
                }
            }

            steamInfo.installedApps = [...installedApps];
            console.log(`[Steam] Found ${installedApps.size} installed apps`);
        }
    } catch (e) {
        console.log('[Steam] Could not detect Steam installation:', e.message);
    }
}

// Detect Steam on startup
detectSteam();

// Build the game scan list dynamically based on Steam + always-scan default
function buildGameScanList() {
    // Always scan these games (most commonly hosted as dedicated servers)
    // For Minecraft, we scan a range to catch alternative servers.
    // For Steam games, 27015 is standard but it can go up to 27020.
    const alwaysScan = [
        { type: 'minecraft', portRange: [25565, 25575], displayName: 'Minecraft', steamAppId: null, joinPrefix: null },
        { type: 'minecraft', port: 28998, displayName: 'Minecraft (Fantasy MC)', steamAppId: null, joinPrefix: null },
        { type: 'garrysmod', portRange: [27015, 27020], displayName: "Garry's Mod", steamAppId: '4000', joinPrefix: 'steam://connect/' },
        { type: 'counterstrike2', portRange: [27015, 27020], displayName: 'Counter-Strike 2', steamAppId: '730', joinPrefix: 'steam://connect/' },
        { type: 'teamfortress2', portRange: [27015, 27020], displayName: 'Team Fortress 2', steamAppId: '440', joinPrefix: 'steam://connect/' },
        { type: 'rust', portRange: [28015, 28020], displayName: 'Rust', steamAppId: '252490', joinPrefix: 'steam://connect/' },
        { type: 'valheim', port: 2456, displayName: 'Valheim', steamAppId: '892970', joinPrefix: 'steam://connect/' },
        { type: 'palworld', port: 8212, displayName: 'Palworld', steamAppId: '1623730', joinPrefix: null },
        { type: 'terrariatshock', port: 7777, displayName: 'Terraria', steamAppId: '105600', joinPrefix: null },
        { type: 'beammp', port: 30814, displayName: 'BeamMP', steamAppId: '284160', joinPrefix: null },
    ];

    // Additional games to scan if they're installed on Steam
    const steamConditional = [
        { type: 'ase', portRange: [27015, 27020], displayName: 'ARK: Survival Evolved', steamAppId: '346110', joinPrefix: 'steam://connect/' },
        { type: 'projectzomboid', port: 16261, displayName: 'Project Zomboid', steamAppId: '108600', joinPrefix: null },
        { type: 'dst', port: 10999, displayName: "Don't Starve Together", steamAppId: '322330', joinPrefix: null },
        { type: 'theforest', portRange: [27015, 27020], displayName: 'The Forest', steamAppId: '242760', joinPrefix: 'steam://connect/' },
        { type: 'unturned', portRange: [27015, 27020], displayName: 'Unturned', steamAppId: '304930', joinPrefix: 'steam://connect/' },
        { type: 'dayz', portRange: [2302, 2305], displayName: 'DayZ', steamAppId: '221100', joinPrefix: 'steam://connect/' },
        { type: 'arma3', portRange: [2302, 2305], displayName: 'ARMA 3', steamAppId: '107410', joinPrefix: 'steam://connect/' },
        { type: 'satisfactory', port: 7777, displayName: 'Satisfactory', steamAppId: '526870', joinPrefix: null },
        { type: 'factorio', port: 34197, displayName: 'Factorio', steamAppId: '427520', joinPrefix: null },
        { type: 'conanexiles', port: 27015, displayName: 'Conan Exiles', steamAppId: '440900', joinPrefix: 'steam://connect/' },
        { type: 'enshrouded', port: 15636, displayName: 'Enshrouded', steamAppId: '1172620', joinPrefix: null },
        { type: 'corekeeper', port: 1234, displayName: 'Core Keeper', steamAppId: '1963720', joinPrefix: null },
        { type: 'starbound', port: 21025, displayName: 'Starbound', steamAppId: '211820', joinPrefix: null },
        { type: 'sdtd', port: 26900, displayName: '7 Days to Die', steamAppId: '251570', joinPrefix: 'steam://connect/' },
        { type: 'l4d2', port: 27015, displayName: 'Left 4 Dead 2', steamAppId: '550', joinPrefix: 'steam://connect/' },
        { type: 'assettocorsa', port: 9610, displayName: 'Assetto Corsa', steamAppId: '244210', joinPrefix: null },
        { type: 'beammp', port: 30814, displayName: 'BeamNG.drive (BeamMP)', steamAppId: '284160', joinPrefix: null },
        { type: 'css', port: 27015, displayName: 'Counter-Strike: Source', steamAppId: '240', joinPrefix: 'steam://connect/' },
        { type: 'spaceengineers', port: 27015, displayName: 'Space Engineers', steamAppId: '244850', joinPrefix: 'steam://connect/' },
        { type: 'eco', port: 3000, displayName: 'Eco', steamAppId: '236850', joinPrefix: null },
        { type: 'theisle', port: 7707, displayName: 'The Isle', steamAppId: '834910', joinPrefix: null },
        { type: 'soulmask', port: 8777, displayName: 'Soulmask', steamAppId: '1928980', joinPrefix: null },
        { type: 'icarus', port: 27015, displayName: 'Icarus', steamAppId: '1149460', joinPrefix: 'steam://connect/' },
    ];

    const scanList = [...alwaysScan];
    const addedTypes = new Set(alwaysScan.map(g => g.type));

    for (const game of steamConditional) {
        if (addedTypes.has(game.type)) continue;
        // Add if Steam is installed and this game is installed, OR if Steam isn't detected (scan everything)
        if (!steamInfo.installed || steamInfo.installedApps.includes(game.steamAppId)) {
            scanList.push(game);
            addedTypes.add(game.type);
        }
    }

    // Expand ranges into distinct port entries
    const expandedList = [];
    for (const game of scanList) {
        if (game.portRange) {
            for (let p = game.portRange[0]; p <= game.portRange[1]; p++) {
                expandedList.push({ ...game, port: p });
            }
        } else {
            expandedList.push(game);
        }
    }

    return expandedList;
}

// --- Minecraft LAN Listener (UDP Multicast) ---
const lanServerListener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
lanServerListener.on('error', (err) => {
    console.error(`LAN server listener error:\n${err.stack}`);
    lanServerListener.close();
});

lanServerListener.on('message', (msg, rinfo) => {
    const message = msg.toString('utf8');
    const motdMatch = message.match(/\[MOTD\](.*?)\[\/MOTD\]/);
    const adMatch = message.match(/\[AD\](.*?)\[\/AD\]/);

    if (motdMatch && adMatch) {
        const motd = motdMatch[1];
        const port = parseInt(adMatch[1], 10);

        const selfIps = tailscale.getSelfIps();
        const publishIp = selfIps.length > 0 ? selfIps[0] : '127.0.0.1';
        const serverKey = `${publishIp}:${port}`;

        lanGameServers.set(serverKey, {
            ip: publishIp,
            port: port,
            name: motd,
            hostName: steamInfo.personaName || 'Local Machine',
            game: 'minecraft',
            gameType: 'minecraft',
            displayName: 'Minecraft',
            map: 'LAN World',
            players: { online: 1, max: 8, list: [] },
            ping: 1,
            joinUrl: null,
            steamAppId: null,
            lastSeen: Date.now()
        });
    }
});

lanServerListener.on('listening', () => {
    try {
        lanServerListener.addMembership('224.0.2.60');
        console.log('[GameBrowser] Minecraft LAN listener active on port 4445');
    } catch (e) {
        // Ignore multicast errors
    }
});

try {
    lanServerListener.bind(4445);
} catch (e) {
    console.error('[GameBrowser] Failed to bind LAN server listener', e);
}

// --- Game Server Scanner ---
let lastScanTime = 0;

async function scanGameServers() {
    const scanStart = Date.now();
    const peers = tailscale.getActivePeers();
    const newServers = [];

    // Only scan online peers and localhost
    const ipsToScan = peers.filter(p => p.isOnline).map(p => p.ip);
    if (!ipsToScan.includes('127.0.0.1')) ipsToScan.push('127.0.0.1');

    const gamesToScan = buildGameScanList();
    console.log(`[GameBrowser] Scanning ${ipsToScan.length} online hosts x ${gamesToScan.length} game queries...`);

    const scanPromises = [];

    for (const ip of ipsToScan) {
        const peerInfo = peers.find(p => p.ip === ip) || { name: (ip === '127.0.0.1' ? (steamInfo.personaName || 'Local Machine') : 'Unknown') };

        for (const game of gamesToScan) {
            const queryPromise = game.type === 'beammp'
                ? new Promise((resolve, reject) => {
                    const net = require('net');
                    const socket = new net.Socket();
                    socket.setTimeout(2000);
                    socket.on('connect', () => {
                        resolve({
                            name: 'BeamMP Server',
                            map: 'Unknown',
                            numplayers: 0,
                            maxplayers: 0,
                            players: [],
                            raw: { folder: 'beammp' },
                            queryPort: game.port
                        });
                        socket.destroy();
                    });
                    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
                    socket.on('error', (err) => { reject(err); });
                    socket.connect(game.port, ip);
                })
                : GameDig.query({
                    type: game.type,
                    host: ip,
                    port: game.port,
                    maxAttempts: 1,
                    socketTimeout: 2000,
                    attemptTimeout: 2500
                });

            scanPromises.push(
                queryPromise.then((state) => {
                    let version = state.raw && state.raw.version ? state.raw.version : null;
                    let modPack = null;

                    if (game.type === 'minecraft' && state.raw && state.raw.vanilla === false) {
                        modPack = 'Modded Server';
                    }

                    const gamePort = state.connect ? parseInt(state.connect.split(':').pop()) : (state.queryPort || game.port);
                    let joinUrl = game.joinPrefix ? `${game.joinPrefix}${ip}:${gamePort}` : null;

                    // Use the server's actual game folder/appId to determine the real game
                    // This prevents GMod on port 27015 from also appearing as CS2 and TF2
                    let actualGameType = game.type;
                    let actualDisplayName = game.displayName;
                    let actualSteamAppId = game.steamAppId;

                    if (state.raw) {
                        const folder = state.raw.folder || state.raw.game;
                        const steamAppFromResponse = state.raw.steamappid || state.raw.appId;

                        // Map the Valve response folder to the correct game
                        const FOLDER_MAP = {
                            'garrysmod': { type: 'garrysmod', name: "Garry's Mod", appId: '4000' },
                            'cstrike': { type: 'css', name: 'Counter-Strike: Source', appId: '240' },
                            'csgo': { type: 'counterstrike2', name: 'Counter-Strike 2', appId: '730' },
                            'cs2': { type: 'counterstrike2', name: 'Counter-Strike 2', appId: '730' },
                            'tf': { type: 'teamfortress2', name: 'Team Fortress 2', appId: '440' },
                            'left4dead2': { type: 'l4d2', name: 'Left 4 Dead 2', appId: '550' },
                            'rust': { type: 'rust', name: 'Rust', appId: '252490' },
                            'insurgency': { type: 'insurgency', name: 'Insurgency', appId: '222880' },
                            'ins2': { type: 'insurgencysandstorm', name: 'Insurgency: Sandstorm', appId: '581320' },
                            'svencoop': { type: 'svencoop', name: 'Sven Co-op', appId: '17710' },
                        };

                        if (folder && FOLDER_MAP[folder]) {
                            actualGameType = FOLDER_MAP[folder].type;
                            actualDisplayName = FOLDER_MAP[folder].name;
                            actualSteamAppId = FOLDER_MAP[folder].appId;
                        } else if (steamAppFromResponse) {
                            const appStr = String(steamAppFromResponse);
                            const mapped = STEAM_APP_MAP[appStr];
                            if (mapped) {
                                actualGameType = mapped.gamedigType || game.type;
                                actualDisplayName = mapped.displayName;
                                actualSteamAppId = appStr;
                            }
                        }
                    }

                    // Deduplicate by IP + port only (not game type)
                    // This prevents the same server from showing up multiple times
                    const existing = newServers.find(s => s.ip === ip && s.port === gamePort);
                    if (!existing) {
                        newServers.push({
                            ip,
                            port: gamePort,
                            hostName: peerInfo.name,
                            name: state.name || `${actualDisplayName} Server`,
                            game: actualDisplayName,
                            gameType: actualGameType,
                            displayName: actualDisplayName,
                            map: state.map || null,
                            players: {
                                online: state.numplayers ?? (state.players ? state.players.length : 0),
                                max: state.maxplayers || 0,
                                list: (state.players || []).map(p => p.name).filter(Boolean)
                            },
                            version,
                            favicon: game.type === 'minecraft' && state.raw ? state.raw.favicon : null,
                            modPack,
                            joinUrl,
                            steamAppId: actualSteamAppId,
                            ping: state.ping
                        });
                    }
                }).catch(() => {
                    // Ignore offline/timeout
                })
            );
        }
    }

    await Promise.allSettled(scanPromises);
    discoveredGameServers = newServers;
    lastScanTime = Date.now();

    const elapsed = Date.now() - scanStart;
    console.log(`[GameBrowser] Scan complete: ${newServers.length} servers found in ${elapsed}ms`);
}

// Initial scan and then every 45 seconds
scanGameServers();
setInterval(scanGameServers, 45000);

// --- API Endpoints ---

// Get all discovered game servers (with live LAN merge)
app.get('/api/game/servers', (req, res) => {
    const now = Date.now();
    const responseServers = [...discoveredGameServers];

    for (const [key, server] of lanGameServers.entries()) {
        if (now - server.lastSeen > 10000) {
            lanGameServers.delete(key);
        } else {
            if (!responseServers.find(s => s.ip === server.ip && s.port === server.port)) {
                responseServers.push(server);
            }
        }
    }

    res.json(responseServers);
});

// Trigger a manual rescan
app.post('/api/game/servers/scan', async (req, res) => {
    // Rate limit: minimum 10 seconds between scans
    if (Date.now() - lastScanTime < 10000) {
        return res.json({ status: 'throttled', message: 'Scan ran recently. Try again in a few seconds.' });
    }
    await scanGameServers();
    // Return the fresh results
    const now = Date.now();
    const responseServers = [...discoveredGameServers];
    for (const [key, server] of lanGameServers.entries()) {
        if (now - server.lastSeen > 10000) {
            lanGameServers.delete(key);
        } else {
            if (!responseServers.find(s => s.ip === server.ip && s.port === server.port)) {
                responseServers.push(server);
            }
        }
    }
    res.json(responseServers);
});

// Steam info endpoint
app.get('/api/steam/info', (req, res) => {
    const installedGames = [];
    for (const appId of steamInfo.installedApps) {
        const mapped = STEAM_APP_MAP[appId];
        if (mapped) {
            installedGames.push({
                steamAppId: appId,
                name: mapped.displayName,
                canHostServer: mapped.gamedigType !== null,
                gamedigType: mapped.gamedigType
            });
        }
    }

    res.json({
        installed: steamInfo.installed,
        personaName: steamInfo.personaName,
        steamId: steamInfo.steamId,
        installedGames,
        totalInstalledApps: steamInfo.installedApps.length,
        supportedGamesScanning: buildGameScanList().length,
        lastScanTime
    });
});

// Get list of all supported game types
// Fetch Workshop Collection Details
app.get('/api/steam/collection/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'ID required' });

    try {
        const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `itemcount=1&publishedfileids[0]=${id}`
        });

        const data = await response.json();

        if (data.response && data.response.publishedfiledetails && data.response.publishedfiledetails.length > 0) {
            const details = data.response.publishedfiledetails[0];
            if (details.result === 1) {
                return res.json({
                    id: details.publishedfileid,
                    title: details.title,
                    description: details.description,
                    previewUrl: details.preview_url,
                    appId: details.creator_app_id,
                    appName: details.app_name,
                    fileSize: details.file_size,
                    subscriptions: details.subscriptions
                });
            } else {
                return res.status(404).json({ error: 'Collection not found or access denied', result: details.result });
            }
        }

        res.status(404).json({ error: 'Collection not found' });
    } catch (err) {
        console.error('Steam Collection API Error:', err);
        res.status(500).json({ error: 'Failed to fetch collection details' });
    }
});

app.get('/api/game/supported', (req, res) => {
    const games = buildGameScanList().map(g => ({
        type: g.type,
        name: g.displayName,
        defaultPort: g.port,
        steamAppId: g.steamAppId,
        hasJoinUrl: !!g.joinPrefix,
        installed: g.steamAppId ? steamInfo.installedApps.includes(g.steamAppId) : null
    }));
    // Also add Minecraft LAN
    if (!games.find(g => g.type === 'minecraft')) {
        games.unshift({ type: 'minecraft', name: 'Minecraft (Java)', defaultPort: 25565, steamAppId: null, hasJoinUrl: false, installed: null });
    }
    res.json(games);
});

const staticPath = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : path.join(__dirname, '../frontend/dist');
app.use(express.static(staticPath));

// Handle React routing, return all requests to React app
app.use((req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '::', () => {
    console.log(`JellyChat HTTP backend running on port ${PORT}`);
});

const certPath = path.join(__dirname, '../win-ae3001k48l8.beefalo-truck.ts.net.crt');
const keyPath = path.join(__dirname, '../win-ae3001k48l8.beefalo-truck.ts.net.key');

let httpsOptions = {};
try {
    httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
} catch (e) {
    console.log("Could not load Tailscale certs, falling back to self-signed...");
    const attrs = [{ name: 'commonName', value: 'jellychat.local' }];
    const pems = selfsigned.generate(attrs, { days: 365 });
    httpsOptions = {
        key: pems.private,
        cert: pems.cert
    };
}

const httpsServer = https.createServer(httpsOptions, app);

io.attach(httpsServer);

const HTTPS_PORT = process.env.HTTPS_PORT || 4001;
httpsServer.listen(HTTPS_PORT, '::', () => {
    console.log(`JellyChat HTTPS backend running on port ${HTTPS_PORT}`);
});



