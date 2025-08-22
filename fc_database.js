const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'fc_chat.db'));

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS fc_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            code TEXT DEFAULT '' NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS fc_sessions (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS fc_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            text TEXT,
            message_type TEXT NOT NULL DEFAULT 'text',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_edited INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            chat_type TEXT DEFAULT 'group',
            recipient TEXT,
            read INTEGER DEFAULT 0
        )
    `);
    
    db.all("PRAGMA table_info(fc_messages)", (err, columns) => {
        if (err) {
            console.error('Ошибка получения информации о таблице:', err);
            return;
        }
        
        const columnNames = columns.map(col => col.name);
        
        if (!columnNames.includes('chat_type')) {
            db.run(`
                ALTER TABLE fc_messages ADD COLUMN chat_type TEXT DEFAULT 'group'
            `, (alterErr) => {
                if (alterErr) {
                    console.error('Ошибка добавления chat_type:', alterErr);
                } else {
                    console.log('Столбец chat_type добавлен');
                }
            });
        }
        
        if (!columnNames.includes('recipient')) {
            db.run(`
                ALTER TABLE fc_messages ADD COLUMN recipient TEXT
            `, (alterErr) => {
                if (alterErr) {
                    console.error('Ошибка добавления recipient:', alterErr);
                } else {
                    console.log('Столбец recipient добавлен');
                }
            });
        }
        
        if (!columnNames.includes('read')) {
            db.run(`
                ALTER TABLE fc_messages ADD COLUMN read INTEGER DEFAULT 0
            `, (alterErr) => {
                if (alterErr) {
                    console.error('Ошибка добавления read:', alterErr);
                } else {
                    console.log('Столбец read добавлен');
                }
            });
        }
    });
});

function fc_addMessage(messageData, callback) {
    const { 
        username, 
        text = null, 
        messageType = 'text',
        chatType = 'group',
        recipient = null
    } = messageData;
    
    const stmt = db.prepare(`
        INSERT INTO fc_messages (
            username, 
            text, 
            message_type,
            chat_type,
            recipient
        ) VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
        username, 
        text, 
        messageType,
        chatType,
        recipient,
        function(err) {
            callback(err, this.lastID);
        }
    );
    stmt.finalize();
}

function fc_editMessage(messageId, newText, callback) {
    const stmt = db.prepare(`
        UPDATE fc_messages 
        SET text = ?, is_edited = 1 
        WHERE id = ?
    `);
    stmt.run(newText, messageId, callback);
    stmt.finalize();
}

function fc_deleteMessage(messageId, callback) {
    const stmt = db.prepare(`
        UPDATE fc_messages 
        SET is_deleted = 1 
        WHERE id = ?
    `);
    stmt.run(messageId, callback);
    stmt.finalize();
}

function fc_getRecentMessages(options = {}, limit = 50, callback) {
    const { 
        chatType = 'group', 
        recipient = null,
        currentUser = null
    } = options;
    
    let query = `
        SELECT * FROM fc_messages 
        WHERE is_deleted = 0 
        AND chat_type = ?
    `;
    
    const params = [chatType];
    
    if (chatType === 'private' && recipient && currentUser) {
        query += ` AND (
            (username = ? AND recipient = ?) 
            OR 
            (username = ? AND recipient = ?)
        )`;
        params.push(currentUser, recipient, recipient, currentUser);
    }
    
    query += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);
    
    db.all(query, params, callback);
}

function fc_getMessageById(messageId, callback) {
    db.get(`
        SELECT * FROM fc_messages 
        WHERE id = ?
    `, [messageId], callback);
}

function fc_markMessagesAsRead(recipient, sender, callback) {
    const stmt = db.prepare(`
        UPDATE fc_messages 
        SET read = 1 
        WHERE recipient = ? 
        AND username = ? 
        AND chat_type = 'private'
        AND read = 0
    `);
    stmt.run(recipient, sender, function(err) {
        if (err) {
            callback(err);
        } else {
            callback(null, this.changes);
        }
    });
    stmt.finalize();
}

function fc_getUnreadMessagesCount(username, callback) {
    db.get(`
        SELECT COUNT(*) as count 
        FROM fc_messages 
        WHERE recipient = ? 
        AND chat_type = 'private'
        AND read = 0
        AND is_deleted = 0
    `, [username], (err, row) => {
        callback(err, row ? row.count : 0);
    });
}

function fc_getUnreadMessagesPerUser(username, callback) {
    const query = `
        SELECT username as sender, COUNT(*) as count
        FROM fc_messages 
        WHERE recipient = ? 
        AND chat_type = 'private'
        AND read = 0
        AND is_deleted = 0
        GROUP BY username
    `;
    
    db.all(query, [username], (err, rows) => {
        if (err) {
            callback(err, null);
            return;
        }
        
        const result = {};
        rows.forEach(row => {
            result[row.sender] = row.count;
        });
        
        callback(null, result);
    });
}

module.exports = {
    fc_addMessage,
    fc_editMessage,
    fc_deleteMessage,
    fc_getRecentMessages,
    fc_getMessageById,
    fc_markMessagesAsRead,
    fc_getUnreadMessagesCount,
    fc_getUnreadMessagesPerUser,
    db
};