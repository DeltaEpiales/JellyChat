require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const tailscale = require('./tailscale');
const webpush = require('web-push');
const { getLinkPreview } = require('link-preview-js');
const nodemailer = require('nodemailer');

const multer = require('multer');
const fs = require('fs');
const child_process = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// Setup Web Push
const vapidKeys = JSON.parse(fs.readFileSync(path.join(__dirname, 'vapidKeys.json'), 'utf8'));
webpush.setVapidDetails(
  'mailto:test@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Setup uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Setup roms dir
const romsDir = path.join(__dirname, 'roms');
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
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
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

io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.tailscaleDeviceName} (${socket.tailscaleIp})`);
  connectedIps.add(socket.tailscaleIp);
  
  // Join personal room based on IP for P2P messaging
  socket.join(socket.tailscaleIp);

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

      // Check for @Jellybot trigger
      if (content && content.toLowerCase().startsWith('@jellybot')) {
          handleJellybotMessage(socket, savedMessage, channelId, recipientId);
      }
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
  
  socket.on('workspace_draw', ({ room, data }) => {
      // Fix nested payload structure: unpack data
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
      
      // Trigger Web Push Notification for calls
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
      // Leave existing voice channels if any
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
      // data: { toId (socket.id), type ('offer'|'answer'|'ice_candidate'), payload }
      // relay directly to the target socket
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

  // --- P2P File Transfer Signaling ---
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

  // --- Collaborative Workspace ---
  // (Moved here for better readability in actual structure)
});

// --- @Jellybot AI Assistant ---
async function handleJellybotMessage(socket, triggerMessage, channelId, recipientId) {
    const openWebUiUrl = process.env.OPENWEBUI_URL || 'http://localhost:3000';
    const apiKey = process.env.OPENWEBUI_API_KEY || '';
    const userPrompt = triggerMessage.content.replace(/^@jellybot\s*/i, '').trim();
    if (!userPrompt) return;

    try {
        // Get context: last 20 messages from the channel/DM
        let contextMessages = [];
        if (!recipientId) {
            contextMessages = await db.getMessages(null, null, channelId, 20);
        } else {
            contextMessages = await db.getMessages(socket.tailscaleIp, recipientId, null, 20);
        }

        const chatHistory = contextMessages.map(m => ({
            role: m.senderId === 'jellybot' ? 'assistant' : 'user',
            content: `${m.senderName}: ${m.content}`
        }));

        chatHistory.push({
            role: 'system',
            content: 'You are Jellybot, a friendly and helpful AI assistant embedded in Jellychat, a private group chat platform. Keep responses concise and conversational. Use emoji naturally. You can see the recent chat history for context.'
        });

        // Save placeholder bot message
        const botMessage = await db.saveMessage('jellybot', '🤖 Jellybot', '', recipientId, 'text', null, null, triggerMessage.id, channelId);

        // Emit placeholder
        if (!recipientId) {
            io.to(`channel_${channelId}`).emit('new_message', botMessage);
        } else {
            io.to(recipientId).emit('new_message', botMessage);
            socket.emit('new_message', botMessage);
        }

        // Try streaming from Open WebUI
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(`${openWebUiUrl}/api/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: process.env.OPENWEBUI_MODEL || 'llama3',
                messages: [
                    ...chatHistory,
                    { role: 'user', content: userPrompt }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Jellybot API error:', response.status, errText);
            const fallbackContent = '😅 Sorry, I couldn\'t connect to the AI backend. Make sure Open WebUI is running!';
            await db.editMessage(botMessage.id, fallbackContent);
            io.emit('message_edited', { messageId: botMessage.id, newContent: fallbackContent });
            return;
        }

        let fullResponse = '';
        const reader = response.body;
        const decoder = new TextDecoder();

        for await (const chunk of reader) {
            const text = decoder.decode(chunk, { stream: true });
            const lines = text.split('\n').filter(line => line.trim().startsWith('data:'));

            for (const line of lines) {
                const jsonStr = line.replace('data: ', '').trim();
                if (jsonStr === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        fullResponse += delta;
                        io.emit('jellybot_stream', { messageId: botMessage.id, chunk: delta, fullContent: fullResponse });
                    }
                } catch (e) { /* skip non-JSON lines */ }
            }
        }

        // Final update to DB
        if (fullResponse) {
            await db.editMessage(botMessage.id, fullResponse);
            io.emit('message_edited', { messageId: botMessage.id, newContent: fullResponse });
        } else {
            const fallback = '🤔 I got an empty response. Try asking again!';
            await db.editMessage(botMessage.id, fallback);
            io.emit('message_edited', { messageId: botMessage.id, newContent: fallback });
        }
    } catch (err) {
        console.error('Jellybot error:', err);
    }
}

// --- Game Save State Endpoints ---
app.post('/api/saves', async (req, res) => {
    const rawIp = req.ip || req.connection.remoteAddress;
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
    const rawIp = req.ip || req.connection.remoteAddress;
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

app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const rawIp = req.ip || req.connection.remoteAddress;
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
const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
        user: 'wdc5c5zaor5lnmva@ethereal.email',
        pass: '8BdM5QBaUw4Nc3Fn7z'
    }
});

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
    try {
        const payload = JSON.parse(payloadString);
        let info = await transporter.sendMail({
            from: '"Jellychat Notifications" <noreply@jellychat.local>',
            to: `user-${ip.replace(/\./g, '-')}@example.com`,
            subject: payload.title,
            text: payload.body,
        });
        console.log(`Email fallback sent for ${ip}. Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    } catch (err) {
        console.error('Error sending fallback email', err);
    }
}

app.post('/api/subscribe', async (req, res) => {
    const rawIp = req.ip || req.connection.remoteAddress;
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

app.post('/api/keys', async (req, res) => {
    const rawIp = req.ip || req.connection.remoteAddress;
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
        const workflowPath = path.join(__dirname, 'comfy_workflow.json');
        let comfyPrompt = {};
        if (fs.existsSync(workflowPath)) {
            comfyPrompt = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
            // Inject the user's prompt into the specific Ideogram node
            if (comfyPrompt["98:24"] && comfyPrompt["98:24"].inputs) {
                comfyPrompt["98:24"].inputs.text = prompt;
            } else {
                // Fallback text node injection if IDs change
                for (const key in comfyPrompt) {
                    if (comfyPrompt[key].class_type === 'CLIPTextEncode' && typeof comfyPrompt[key].inputs.text === 'string') {
                        comfyPrompt[key].inputs.text = prompt;
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
        while (retries < 300) {
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
    const rawIp = req.ip || req.connection.remoteAddress;
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    
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
    const rawIp = req.ip || req.connection.remoteAddress;
    let cleanIp = rawIp.replace(/^::ffff:/, '');
    
    let isHost = false;
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        isHost = true;
    } else {
        const selfIps = tailscale.getSelfIps();
        if (selfIps.includes(cleanIp)) isHost = true;
    }

    const isAdmin = await isRequesterAdmin(req);
    res.json({ isHost, isAdmin });
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
    const rawIp = req.ip || req.connection.remoteAddress;
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
        io.emit('profiles_updated', { profiles: updatedProfiles, assignments: updatedAssignments });
        
    } catch (err) {
        res.status(500).json({ error: 'Failed to assign device' });
    }
});

app.post('/api/assignments', async (req, res) => {
    if (!(await isRequesterAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

    const { ip, profileId } = req.body;
    try {
        await db.assignDevice(ip, profileId);
        res.status(201).json({ ip, profileId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to assign device' });
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
                            reusable: false,
                            ephemeral: true,
                            preauthorized: true,
                            tags: ["tag:guest"]
                        }
                    }
                },
                expirySeconds: 86400
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
        statusData: peerStatuses.get(p.ip) || null
    }));
    res.json(enrichedPeers);
});

app.get('/api/me', (req, res) => {
    const rawIp = req.ip || req.connection.remoteAddress;
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
        const endpoint = query.trim() === '' 
              ? `https://g.tenor.com/v1/trending?key=LIVDSRZULELA&limit=30`
              : `https://g.tenor.com/v1/search?key=LIVDSRZULELA&q=${encodeURIComponent(query)}&limit=30`;
        
        // Dynamic import for node-fetch if native fetch isn't available, but Node 18+ has native fetch.
        // Let's use native fetch.
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
        child_process.exec(`ping -n 1 -w 1000 ${ip}`, (err, stdout) => {
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
        child_process.exec(`retroarch --connect ${peerIp}`, (err) => {
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

app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Handle React routing, return all requests to React app
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
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
