const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'chat.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    initDb();
  }
});

function initDb() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                senderId TEXT,
                senderName TEXT,
                recipientId TEXT,
                content TEXT,
                type TEXT DEFAULT 'text',
                attachmentUrl TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                ip TEXT PRIMARY KEY,
                subscription TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS public_keys (
                ip TEXT PRIMARY KEY,
                jwk TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT,
                avatar TEXT,
                isAdmin INTEGER DEFAULT 0
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS device_assignments (
                ip TEXT PRIMARY KEY,
                profileId TEXT,
                FOREIGN KEY(profileId) REFERENCES profiles(id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT DEFAULT 'text'
            )
        `, (err) => {
            if (!err) {
                db.run(`INSERT OR IGNORE INTO channels (id, name, description) VALUES ('general', 'general', 'General public chat')`);
            }
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `, (err) => {
            if (!err) {
                // Initialize default AI settings if they don't exist
                const defaultOpenWebUI = process.env.OPENWEBUI_URL || 'http://localhost:3000';
                const defaultOpenWebUIKey = process.env.OPENWEBUI_API_KEY || '';
                const defaultComfyUI = process.env.COMFYUI_URL || 'http://localhost:8188';

                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('openwebui_url', ?)`, [defaultOpenWebUI]);
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('openwebui_api_key', ?)`, [defaultOpenWebUIKey]);
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('comfyui_url', ?)`, [defaultComfyUI]);
            }
        });

        // Migration for type and attachmentUrl
        db.all("PRAGMA table_info(messages)", (err, columns) => {
            if (err) return;
            
            const hasType = columns.some(c => c.name === 'type');
            if (!hasType) {
                db.run("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'");
            }
            
            const hasAttachment = columns.some(c => c.name === 'attachmentUrl');
            if (!hasAttachment) {
                db.run("ALTER TABLE messages ADD COLUMN attachmentUrl TEXT");
            }

            const hasFileName = columns.some(c => c.name === 'fileName');
            if (!hasFileName) {
                db.run("ALTER TABLE messages ADD COLUMN fileName TEXT");
            }
            
            const hasReactions = columns.some(c => c.name === 'reactions');
            if (!hasReactions) {
                db.run("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'");
            }

            const hasReplyTo = columns.some(c => c.name === 'replyToId');
            if (!hasReplyTo) {
                db.run("ALTER TABLE messages ADD COLUMN replyToId INTEGER");
            }

            const hasStatus = columns.some(c => c.name === 'status');
            if (!hasStatus) {
                db.run("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent'");
            }

            const hasIsEdited = columns.some(c => c.name === 'isEdited');
            if (!hasIsEdited) {
                db.run("ALTER TABLE messages ADD COLUMN isEdited INTEGER DEFAULT 0");
            }

            const hasStickers = columns.some(c => c.name === 'stickers');
            if (!hasStickers) {
                db.run("ALTER TABLE messages ADD COLUMN stickers TEXT DEFAULT '[]'");
            }

            const hasChannelId = columns.some(c => c.name === 'channel_id');
            if (!hasChannelId) {
                db.run("ALTER TABLE messages ADD COLUMN channel_id TEXT DEFAULT 'general'");
            }
        });

        db.all("PRAGMA table_info(channels)", (err, columns) => {
            if (err) return;
            const hasType = columns.some(c => c.name === 'type');
            if (!hasType) {
                db.run("ALTER TABLE channels ADD COLUMN type TEXT DEFAULT 'text'");
            }
        });

        db.all("PRAGMA table_info(profiles)", (err, columns) => {
            if (err) return;
            const hasIsAdmin = columns.some(c => c.name === 'isAdmin');
            if (!hasIsAdmin) {
                db.run("ALTER TABLE profiles ADD COLUMN isAdmin INTEGER DEFAULT 0");
            }
        });

        // TTL / ephemeral messages migration
        db.all("PRAGMA table_info(messages)", (err, columns) => {
            if (err) return;
            const hasTtl = columns.some(c => c.name === 'ttl');
            if (!hasTtl) {
                db.run("ALTER TABLE messages ADD COLUMN ttl INTEGER DEFAULT NULL");
            }
            const hasExpiresAt = columns.some(c => c.name === 'expires_at');
            if (!hasExpiresAt) {
                db.run("ALTER TABLE messages ADD COLUMN expires_at DATETIME DEFAULT NULL");
            }
        });

        // Game saves table
        db.run(`
            CREATE TABLE IF NOT EXISTS game_saves (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT,
                rom_hash TEXT,
                rom_name TEXT,
                save_data TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ip, rom_hash)
            )
        `);
    });
}

function resolveIPs(identifier) {
    return new Promise((resolve) => {
        if (!identifier) return resolve([]);
        db.all('SELECT ip FROM device_assignments WHERE profileId = ?', [identifier], (err, rows) => {
            if (!err && rows && rows.length > 0) {
                resolve(rows.map(r => r.ip));
            } else {
                db.get('SELECT profileId FROM device_assignments WHERE ip = ?', [identifier], (err, row) => {
                    if (!err && row && row.profileId) {
                        db.all('SELECT ip FROM device_assignments WHERE profileId = ?', [row.profileId], (err, rows2) => {
                            resolve(rows2 ? rows2.map(r => r.ip) : [identifier]);
                        });
                    } else {
                        resolve([identifier]);
                    }
                });
            }
        });
    });
}

async function getMessages(user1, user2, channelId, limit = 100) {
    if (!user2) { // Channel messages
        return new Promise((resolve, reject) => {
            const chanId = channelId || 'general';
            db.all('SELECT * FROM messages WHERE recipientId IS NULL AND channel_id = ? ORDER BY timestamp DESC LIMIT ?', [chanId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.reverse());
            });
        });
    }

    const ips1 = await resolveIPs(user1);
    const ips2 = await resolveIPs(user2);

    const placeholders1 = ips1.map(() => '?').join(',');
    const placeholders2 = ips2.map(() => '?').join(',');
    
    const query = `
        SELECT * FROM messages 
        WHERE (senderId IN (${placeholders1}) AND recipientId IN (${placeholders2})) 
           OR (senderId IN (${placeholders2}) AND recipientId IN (${placeholders1})) 
        ORDER BY timestamp DESC LIMIT ?
    `;
    
    const params = [...ips1, ...ips2, ...ips2, ...ips1, limit];
    
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows.reverse());
        });
    });
}

function saveMessage(senderId, senderName, content, recipientId = null, type = 'text', attachmentUrl = null, fileName = null, replyToId = null, channelId = 'general', ttl = null) {
    return new Promise((resolve, reject) => {
        const expiresAt = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null;
        const stmt = db.prepare('INSERT INTO messages (senderId, senderName, recipientId, content, type, attachmentUrl, fileName, replyToId, channel_id, ttl, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run([senderId, senderName, recipientId, content, type, attachmentUrl, fileName, replyToId, channelId, ttl, expiresAt], function(err) {
            if (err) reject(err);
            else {
                db.get('SELECT * FROM messages WHERE id = ?', [this.lastID], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            }
        });
        stmt.finalize();
    });
}

function getChannels() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM channels', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function createChannel(id, name, description, type = 'text') {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT INTO channels (id, name, description, type) VALUES (?, ?, ?, ?)');
        stmt.run([id, name, description, type], function(err) {
            if (err) reject(err);
            else {
                db.get('SELECT * FROM channels WHERE id = ?', [id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            }
        });
        stmt.finalize();
    });
}

function editChannel(id, name, description, type) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('UPDATE channels SET name = ?, description = ?, type = ? WHERE id = ?');
        stmt.run([name, description, type, id], function(err) {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function deleteChannel(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM channels WHERE id = ?', [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function clearGlobalChat() {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM messages WHERE recipientId IS NULL', (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function addReaction(messageId, senderId, emoji) {
    return new Promise((resolve, reject) => {
        db.get('SELECT reactions FROM messages WHERE id = ?', [messageId], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Message not found'));
            
            let reactions = {};
            if (row.reactions) {
                try {
                    reactions = JSON.parse(row.reactions);
                } catch (e) {
                    reactions = {};
                }
            }
            
            // Add or toggle reaction
            if (!reactions[emoji]) reactions[emoji] = [];
            
            if (reactions[emoji].includes(senderId)) {
                reactions[emoji] = reactions[emoji].filter(id => id !== senderId);
                if (reactions[emoji].length === 0) delete reactions[emoji];
            } else {
                reactions[emoji].push(senderId);
            }
            
            const newReactionsStr = JSON.stringify(reactions);
            
            db.run('UPDATE messages SET reactions = ? WHERE id = ?', [newReactionsStr, messageId], function(err) {
                if (err) reject(err);
                else resolve(reactions);
            });
        });
    });
}

function saveSubscription(ip, subscription) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO push_subscriptions (ip, subscription) VALUES (?, ?)');
        stmt.run([ip, JSON.stringify(subscription)], (err) => {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function getSubscription(ip) {
    return new Promise((resolve, reject) => {
        db.get('SELECT subscription FROM push_subscriptions WHERE ip = ?', [ip], (err, row) => {
            if (err) reject(err);
            else resolve(row ? JSON.parse(row.subscription) : null);
        });
    });
}

function getAllSubscriptions() {
    return new Promise((resolve, reject) => {
        db.all('SELECT ip, subscription FROM push_subscriptions', [], (err, rows) => {
            if (err) reject(err);
            else {
                const subs = rows.map(r => ({ ip: r.ip, subscription: JSON.parse(r.subscription) }));
                resolve(subs);
            }
        });
    });
}

function updateMessageStatus(messageIds, status) {
    return new Promise((resolve, reject) => {
        if (!messageIds || messageIds.length === 0) return resolve();
        const placeholders = messageIds.map(() => '?').join(',');
        db.run(`UPDATE messages SET status = ? WHERE id IN (${placeholders})`, [status, ...messageIds], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function editMessage(messageId, newContent) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE messages SET content = ?, isEdited = 1 WHERE id = ?', [newContent, messageId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function editMessageAttachment(messageId, type, attachmentUrl, fileName, content = '') {
    return new Promise((resolve, reject) => {
        db.run('UPDATE messages SET type = ?, attachmentUrl = ?, fileName = ?, content = ? WHERE id = ?', [type, attachmentUrl, fileName, content, messageId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function deleteMessage(messageId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM messages WHERE id = ?', [messageId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function searchMessages(query, limit = 50) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM messages WHERE content LIKE ? AND type = "text" ORDER BY timestamp DESC LIMIT ?', [`%${query}%`, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function addReaction(messageId, ip, emoji) {
    return new Promise((resolve, reject) => {
        db.get('SELECT reactions FROM messages WHERE id = ?', [messageId], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Message not found'));
            
            let reactions = {};
            try {
                reactions = JSON.parse(row.reactions || '{}');
            } catch (e) {}

            if (!reactions[emoji]) {
                reactions[emoji] = [];
            }

            const ipIndex = reactions[emoji].indexOf(ip);
            if (ipIndex > -1) {
                // Toggle off
                reactions[emoji].splice(ipIndex, 1);
                if (reactions[emoji].length === 0) {
                    delete reactions[emoji];
                }
            } else {
                // Toggle on
                reactions[emoji].push(ip);
            }

            const newReactionsStr = JSON.stringify(reactions);
            db.run('UPDATE messages SET reactions = ? WHERE id = ?', [newReactionsStr, messageId], function(err) {
                if (err) return reject(err);
                resolve(reactions);
            });
        });
    });
}

function addSticker(messageId, sticker) {
    return new Promise((resolve, reject) => {
        db.get('SELECT stickers FROM messages WHERE id = ?', [messageId], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Message not found'));
            
            let stickers = [];
            try {
                stickers = JSON.parse(row.stickers || '[]');
            } catch (e) {}

            stickers.push(sticker);

            const newStickersStr = JSON.stringify(stickers);
            db.run('UPDATE messages SET stickers = ? WHERE id = ?', [newStickersStr, messageId], function(err) {
                if (err) return reject(err);
                resolve(stickers);
            });
        });
    });
}

function savePublicKey(ip, jwk) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO public_keys (ip, jwk) VALUES (?, ?)');
        stmt.run([ip, JSON.stringify(jwk)], (err) => {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function getPublicKey(ip) {
    return new Promise((resolve, reject) => {
        db.get('SELECT jwk FROM public_keys WHERE ip = ?', [ip], (err, row) => {
            if (err) reject(err);
            else resolve(row ? JSON.parse(row.jwk) : null);
        });
    });
}

function getAllPublicKeys() {
    return new Promise((resolve, reject) => {
        db.all('SELECT ip, jwk FROM public_keys', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => ({ ip: r.ip, jwk: JSON.parse(r.jwk) })));
        });
    });
}

function createProfile(id, name, avatar = null, isAdmin = 0) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO profiles (id, name, avatar, isAdmin) VALUES (?, ?, ?, ?)');
        stmt.run([id, name, avatar, isAdmin], (err) => {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function getProfiles() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM profiles', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getProfileById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM profiles WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getDeviceAssignment(ip) {
    return new Promise((resolve, reject) => {
        db.get('SELECT profileId FROM device_assignments WHERE ip = ?', [ip], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.profileId : null);
        });
    });
}

function assignDevice(ip, profileId) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO device_assignments (ip, profileId) VALUES (?, ?)');
        stmt.run([ip, profileId], (err) => {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function getDeviceAssignments() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM device_assignments', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}



function pruneExpiredMessages() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')", [], (err, rows) => {
            if (err) return reject(err);
            if (!rows || rows.length === 0) return resolve([]);
            const ids = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids, (err) => {
                if (err) reject(err);
                else resolve(ids);
            });
        });
    });
}

function saveGameState(ip, romHash, romName, saveData) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT OR REPLACE INTO game_saves (ip, rom_hash, rom_name, save_data, updated_at) VALUES (?, ?, ?, ?, datetime("now"))');
        stmt.run([ip, romHash, romName, saveData], (err) => {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

function getGameState(ip, romHash) {
    return new Promise((resolve, reject) => {
        db.get('SELECT save_data, rom_name, updated_at FROM game_saves WHERE ip = ? AND rom_hash = ?', [ip, romHash], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function getLastMessagePerChannel() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT m.channel_id, m.content, m.senderName, m.timestamp, m.type
            FROM messages m
            INNER JOIN (
                SELECT channel_id, MAX(id) as max_id
                FROM messages
                WHERE recipientId IS NULL
                GROUP BY channel_id
            ) latest ON m.id = latest.max_id
        `, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getChannelMessageCounts() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT channel_id, COUNT(*) as count
            FROM messages
            WHERE recipientId IS NULL
            GROUP BY channel_id
        `, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getSettings() {
    return new Promise((resolve, reject) => {
        db.all("SELECT key, value FROM settings", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const settings = {};
                rows.forEach(r => settings[r.key] = r.value);
                resolve(settings);
            }
        });
    });
}

function saveSetting(key, value) {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

module.exports = {
    saveMessage,
    getMessages,
    addReaction,
    addSticker,
    editMessage,
    editMessageAttachment,
    deleteMessage,
    getChannels,
    createChannel,
    editChannel,
    deleteChannel,
    saveSubscription,
    getSubscription,
    getAllSubscriptions,
    updateMessageStatus,
    searchMessages,
    clearGlobalChat,
    savePublicKey,
    getPublicKey,
    getAllPublicKeys,
    getProfiles,
    getProfileById,
    getDeviceAssignment,
    createProfile,
    getDeviceAssignments,
    assignDevice,
    pruneExpiredMessages,
    saveGameState,
    getGameState,
    getLastMessagePerChannel,
    getChannelMessageCounts,
    getSettings,
    saveSetting
};
