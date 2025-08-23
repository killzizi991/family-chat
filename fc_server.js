const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const { 
    fc_registerUser, 
    fc_loginUser,
    fc_logoutUser,
    fc_validateSession 
} = require('./fc_auth');
const { 
    fc_addMessage, 
    fc_editMessage, 
    fc_deleteMessage,
    fc_getRecentMessages,
    fc_getMessageById,
    fc_markMessagesAsRead,
    fc_getUnreadMessagesCount,
    fc_getUnreadMessagesPerUser,
    db
} = require('./fc_database');
const { fc_cleanupOldMessages } = require('./fc_cleanup');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const fc_activeConnections = new Map();
const fc_onlineUsers = new Set();
const fc_heartbeatIntervals = new Map();

function fc_authenticate(req, res, next) {
    const sessionId = req.cookies.fc_session;
    const username = fc_validateSession(sessionId);
    
    if (username) {
        req.username = username;
        next();
    } else {
        res.status(401).json({ error: "Требуется аутентификация" });
    }
}

function setupHeartbeat(ws, username) {
    if (fc_heartbeatIntervals.has(username)) {
        clearInterval(fc_heartbeatIntervals.get(username));
    }
    
    const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(interval);
            fc_heartbeatIntervals.delete(username);
        }
    }, 30000);
    
    fc_heartbeatIntervals.set(username, interval);
}

function broadcastOnlineUsers() {
    const onlineUsers = Array.from(fc_onlineUsers);
    const message = JSON.stringify({
        type: 'online_users',
        users: onlineUsers
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function sendUnreadCounts(username) {
    fc_getUnreadMessagesPerUser(username, (err, counts) => {
        if (err) {
            console.error('Ошибка получения непрочитанных сообщений:', err);
            return;
        }
        
        wss.clients.forEach(client => {
            if (fc_activeConnections.get(client) === username) {
                client.send(JSON.stringify({
                    type: 'unread_counts',
                    counts: counts
                }));
            }
        });
    });
}

wss.on('connection', (ws, req) => {
    const cookies = req.headers.cookie;
    const sessionId = cookies && cookies.split(';')
        .find(c => c.trim().startsWith('fc_session='))
        ?.split('=')[1];
    
    const username = sessionId && fc_validateSession(sessionId);
    
    if (!username) {
        ws.close(1008, "Требуется аутентификация");
        return;
    }
    
    console.log(`Новое подключение: ${username}`);
    fc_activeConnections.set(ws, username);
    fc_onlineUsers.add(username);
    setupHeartbeat(ws, username);
    broadcastOnlineUsers();
    sendUnreadCounts(username);
    
    ws.on('pong', () => {
        if (fc_heartbeatIntervals.has(username)) {
            clearInterval(fc_heartbeatIntervals.get(username));
            setupHeartbeat(ws, username);
        }
    });
    
    fc_getRecentMessages({ chatType: 'group' }, 50, (err, messages) => {
        if (err) {
            console.error('Ошибка получения истории:', err);
            return;
        }
        
        if (messages) {
            messages.reverse().forEach(msg => {
                if (!msg.is_deleted) {
                    const message = {
                        id: msg.id,
                        username: msg.username,
                        text: msg.text,
                        messageType: msg.message_type,
                        timestamp: msg.timestamp,
                        is_edited: msg.is_edited,
                        is_deleted: msg.is_deleted,
                        chatType: msg.chat_type,
                        recipient: msg.recipient,
                        read: msg.read
                    };
                    
                    ws.send(JSON.stringify({
                        type: 'chat',
                        data: message
                    }));
                }
            });
        }
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            const chatType = message.chatType || 'group';
            const recipient = message.recipient || null;
            
            switch (message.type) {
                case 'chat':
                    fc_addMessage({
                        username,
                        text: message.text,
                        messageType: 'text',
                        chatType,
                        recipient
                    }, (err, messageId) => {
                        if (err) {
                            console.error('Ошибка сохранения сообщения:', err);
                            return;
                        }
                        
                        const chatMessage = {
                            id: messageId,
                            username,
                            text: message.text,
                            timestamp: new Date().toISOString(),
                            is_edited: 0,
                            is_deleted: 0,
                            chatType,
                            recipient,
                            read: 0
                        };
                        
                        let recipients = null;
                        if (chatType === 'private' && recipient) {
                            recipients = [username, recipient];
                            chatMessage.read = 0;
                            
                            sendUnreadCounts(recipient);
                        }
                        
                        broadcast(JSON.stringify({
                            type: 'chat',
                            data: chatMessage
                        }), recipients);
                        
                        broadcast(JSON.stringify({
                            type: 'refresh',
                            data: { chatType, recipient }
                        }));
                    });
                    break;
                    
                case 'edit':
                    fc_editMessage(message.messageId, message.newText, (err) => {
                        if (err) {
                            console.error('Ошибка редактирования:', err);
                            return;
                        }
                        
                        fc_getMessageById(message.messageId, (err, row) => {
                            if (err || !row) return;
                            
                            broadcast(JSON.stringify({
                                type: 'update',
                                data: {
                                    id: row.id,
                                    username: row.username,
                                    text: row.text,
                                    timestamp: row.timestamp,
                                    is_edited: row.is_edited,
                                    chatType: row.chat_type,
                                    recipient: row.recipient,
                                    read: row.read
                                }
                            }));
                            
                            broadcast(JSON.stringify({
                                type: 'refresh',
                                data: { 
                                    chatType: row.chat_type,
                                    recipient: row.recipient 
                                }
                            }));
                        });
                    });
                    break;
                    
                case 'delete':
                    fc_getMessageById(message.messageId, (err, msg) => {
                        if (err || !msg) return;
                        
                        fc_deleteMessage(message.messageId, (err) => {
                            if (err) {
                                console.error('Ошибка удаления:', err);
                                return;
                            }
                            
                            broadcast(JSON.stringify({
                                type: 'delete',
                                messageId: message.messageId
                            }));
                            
                            broadcast(JSON.stringify({
                                type: 'refresh',
                                data: { 
                                    chatType: msg.chat_type,
                                    recipient: msg.recipient 
                                }
                            }));
                        });
                    });
                    break;
                    
                case 'mark_read':
                    if (message.sender && chatType === 'private') {
                        fc_markMessagesAsRead(username, message.sender, (err, count) => {
                            if (err) {
                                console.error('Ошибка отметки прочтения:', err);
                                return;
                            }
                            
                            if (count > 0) {
                                wss.clients.forEach(client => {
                                    const clientUser = fc_activeConnections.get(client);
                                    if (clientUser === message.sender) {
                                        client.send(JSON.stringify({
                                            type: 'messages_read',
                                            reader: username,
                                            sender: message.sender,
                                            chatWith: username
                                        }));
                                    }
                                });
                                
                                sendUnreadCounts(message.sender);
                                sendUnreadCounts(username);
                            }
                        });
                    }
                    break;

                // Обработка WebRTC сообщений
                case 'call_offer':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'call_offer',
                            from: username,
                            offer: message.offer
                        });
                    }
                    break;

                case 'call_answer':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'call_answer',
                            from: username,
                            answer: message.answer
                        });
                    }
                    break;

                case 'ice_candidate':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'ice_candidate',
                            from: username,
                            candidate: message.candidate
                        });
                    }
                    break;

                case 'call_end':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'call_end',
                            from: username
                        });
                    }
                    break;

                case 'call_reject':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'call_reject',
                            from: username
                        });
                    }
                    break;

                case 'call_busy':
                    if (message.target && fc_onlineUsers.has(message.target)) {
                        forwardMessageToUser(message.target, {
                            type: 'call_busy',
                            from: username
                        });
                    }
                    break;
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });
    
    ws.on('close', () => {
        console.log(`Соединение закрыто: ${username}`);
        fc_activeConnections.delete(ws);
        fc_onlineUsers.delete(username);
        
        if (fc_heartbeatIntervals.has(username)) {
            clearInterval(fc_heartbeatIntervals.get(username));
            fc_heartbeatIntervals.delete(username);
        }
        
        broadcastOnlineUsers();
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});

function forwardMessageToUser(username, message) {
    wss.clients.forEach(client => {
        if (fc_activeConnections.get(client) === username && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

app.post('/api/register', (req, res) => {
    const { username, code } = req.body;
    const result = fc_registerUser(username, code);
    res.json(result);
});

app.post('/api/login', (req, res) => {
    const { username, code } = req.body;
    const result = fc_loginUser(username, code);
    
    if (result.success) {
        res.cookie('fc_session', result.sessionId, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: 'Lax',
            secure: false
        });
    }
    
    res.json(result);
});

app.post('/api/logout', (req, res) => {
    const sessionId = req.cookies.fc_session;
    
    if (sessionId) {
        fc_logoutUser(sessionId);
        res.clearCookie('fc_session');
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, message: "Сессия не найдена" });
    }
});

app.get('/api/check-session', (req, res) => {
    const sessionId = req.cookies.fc_session;
    const username = sessionId && fc_validateSession(sessionId);
    
    if (username) {
        res.json({ loggedIn: true, username });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/api/users', fc_authenticate, async (req, res) => {
    try {
        const users = await new Promise((resolve, reject) => {
            db.all("SELECT username FROM fc_users WHERE username != ?", 
                   [req.username], 
                   (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.map(row => row.username));
                }
            });
        });
        res.json(users);
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

app.get('/api/messages', fc_authenticate, (req, res) => {
    const chatType = req.query.chatType || 'group';
    const withUser = req.query.withUser || null;
    const username = req.username;
    
    const options = {
        chatType: chatType,
        recipient: withUser,
        currentUser: username
    };
    
    fc_getRecentMessages(options, 100, (err, messages) => {
        if (err) {
            console.error('Ошибка получения сообщений:', err);
            return res.status(500).json({ error: "Ошибка сервера" });
        }
        
        if (chatType === 'private' && withUser) {
            const filteredMessages = messages.filter(msg => 
                (msg.username === username && msg.recipient === withUser) ||
                (msg.username === withUser && msg.recipient === username)
            );
            
            res.json(filteredMessages);
        } else {
            res.json(messages);
        }
    });
});

app.get('/api/unread-counts', fc_authenticate, (req, res) => {
    const username = req.username;
    
    fc_getUnreadMessagesPerUser(username, (err, counts) => {
        if (err) {
            console.error('Ошибка получения непрочитанных сообщений:', err);
            return res.status(500).json({ error: "Ошибка сервера" });
        }
        
        res.json(counts);
    });
});

app.post('/api/mark-read', fc_authenticate, (req, res) => {
    const { sender } = req.body;
    const username = req.username;
    
    if (!sender) {
        return res.status(400).json({ error: "Не указан отправитель" });
    }
    
    fc_markMessagesAsRead(username, sender, (err, count) => {
        if (err) {
            console.error('Ошибка отметки прочтения:', err);
            return res.status(500).json({ error: "Ошибка сервера" });
        }
        
        wss.clients.forEach(client => {
            const clientUser = fc_activeConnections.get(client);
            if (clientUser === sender) {
                client.send(JSON.stringify({
                    type: 'messages_read',
                    reader: username,
                    sender: sender,
                    chatWith: username
                }));
            }
        });
        
        sendUnreadCounts(sender);
        sendUnreadCounts(username);
        
        res.json({ success: true, markedCount: count });
    });
});

function broadcast(message, recipients = null) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const clientUser = fc_activeConnections.get(client);
            if (!recipients || recipients.includes(clientUser)) {
                client.send(message);
            }
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    fc_cleanupOldMessages();
    setInterval(fc_cleanupOldMessages, 24 * 60 * 60 * 1000);
});