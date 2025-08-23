if (window.familyChatRestart) {
    console.warn('Обнаружен конфликт. Перезапускаем систему чата...');
    window.location.reload();
}
window.familyChatRestart = true;

if (window.fc_crypto || window.ws || window.currentUser) {
    console.error('Обнаружены конфликтующие глобальные переменные!');
    alert('Обнаружена проблема с расширениями браузера. Пожалуйста, отключите расширения для работы чата.');
}

window.familyChat = {
    ws: null,
    currentUser: null,
    currentChat: { type: 'private', recipient: null },
    privateChatsCache: {},
    onlineUsers: [],
    unreadCounts: {},
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
};

(function() {
    document.addEventListener('DOMContentLoaded', async () => {
        console.log("Ядро чата загружено!");
        
        familyChat.checkSession = async function() {
            const response = await fetch('/api/check-session');
            const result = await response.json();
            
            if (result.loggedIn) {
                familyChat.currentUser = result.username;
                document.getElementById('fc_currentUser').textContent = familyChat.currentUser;
                familyChat.initWebSocket();
                document.getElementById('fc_loginForm').style.display = 'none';
                document.getElementById('fc_registerForm').style.display = 'none';
                document.getElementById('fc_chatContainer').style.display = 'flex';
                document.getElementById('fc_messages').innerHTML += '<div class="system-msg">Вы вошли как ' + familyChat.currentUser + '</div>';
                await familyChat.ui.initChatList();
                familyChat.loadChatHistory();
            }
        };
        
        familyChat.initWebSocket = function() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            familyChat.ws = new WebSocket(protocol + '//' + window.location.host);
            
            familyChat.ws.onopen = () => {
                console.log("WebSocket подключен!");
                familyChat.reconnectAttempts = 0;
                document.getElementById('fc_messages').innerHTML += '<div class="system-msg">Соединение с чатом установлено</div>';
                
                // Устанавливаем обработчик для heartbeat
                familyChat.heartbeatInterval = setInterval(() => {
                    if (familyChat.ws && familyChat.ws.readyState === WebSocket.OPEN) {
                        familyChat.ws.send(JSON.stringify({ type: 'heartbeat' }));
                    }
                }, 25000); // Отправляем heartbeat каждые 25 секунд
            };
            
            familyChat.ws.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    switch (message.type) {
                        case 'online_users':
                            familyChat.onlineUsers = message.users;
                            familyChat.ui.updateOnlineStatus(message.users);
                            break;
                            
                        case 'unread_counts':
                            familyChat.unreadCounts = message.counts;
                            familyChat.ui.updateUnreadCounts(message.counts);
                            break;
                            
                        case 'heartbeat':
                            // Ответ на heartbeat, ничего не делаем
                            break;
                            
                        case 'delete':
                            familyChat.ui.deleteMessage(message.messageId);
                            break;
                            
                        case 'messages_read':
                            familyChat.ui.markAllMessagesAsRead(message.chatWith);
                            break;
                            
                        case 'webrtc_offer':
                        case 'webrtc_answer':
                        case 'webrtc_candidate':
                        case 'webrtc_end_call':
                            if (familyChat.webrtc) {
                                switch (message.type) {
                                    case 'webrtc_offer':
                                        familyChat.webrtc.handleOffer(message.data, message.sender);
                                        break;
                                    case 'webrtc_answer':
                                        familyChat.webrtc.handleAnswer(message.data);
                                        break;
                                    case 'webrtc_candidate':
                                        familyChat.webrtc.handleCandidate(message.data);
                                        break;
                                    case 'webrtc_end_call':
                                        familyChat.webrtc.handleEndCall();
                                        break;
                                }
                            }
                            break;
                            
                        default:
                            const isForCurrentChat = 
                                (familyChat.currentChat.type === 'group' && message.data.chatType === 'group') ||
                                (familyChat.currentChat.type === 'private' && message.data.chatType === 'private' && 
                                 ((familyChat.currentChat.recipient && 
                                  (message.data.recipient === familyChat.currentChat.recipient || 
                                   message.data.username === familyChat.currentChat.recipient))));
                    
                            let chatPartner = null;
                            if (message.data && message.data.chatType === 'private') {
                                chatPartner = message.data.username === familyChat.currentUser 
                                    ? message.data.recipient 
                                    : message.data.username;
                            }
                            
                            if (chatPartner && familyChat.privateChatsCache[chatPartner]) {
                                familyChat.privateChatsCache[chatPartner].push(message.data);
                            }
                            
                            if (isForCurrentChat) {
                                switch (message.type) {
                                    case 'chat':
                                        familyChat.ui.handleChatMessage(message.data);
                                        // Если это личное сообщение и чат активен, отмечаем как прочитанное
                                        if (message.data.chatType === 'private' && 
                                            familyChat.currentChat.type === 'private' &&
                                            familyChat.currentChat.recipient === message.data.username) {
                                            familyChat.markMessagesAsRead(message.data.username);
                                        }
                                        break;
                                    case 'update':
                                        familyChat.ui.updateMessage(message.data);
                                        break;
                                }
                            } else {
                                if (message.type === 'chat') {
                                    const sender = message.data.username;
                                    const chatItems = document.querySelectorAll('.chat-item');
                                    chatItems.forEach(item => {
                                        if (item.dataset.username === sender || 
                                            (item.dataset.chatType === 'group' && message.data.chatType === 'group')) {
                                            item.classList.add('new-message');
                                        }
                                    });
                                }
                            }
                            break;
                    }
                } catch (e) {
                    console.error('Ошибка обработки сообщения:', e);
                }
            };
            
            familyChat.ws.onerror = (error) => {
                console.error("WebSocket ошибка:", error);
                document.getElementById('fc_messages').innerHTML += '<div class="error">Ошибка соединения</div>';
            };
            
            familyChat.ws.onclose = () => {
                console.log('Соединение закрыто');
                
                // Очищаем интервал heartbeat
                if (familyChat.heartbeatInterval) {
                    clearInterval(familyChat.heartbeatInterval);
                }
                
                familyChat.ws = null;
                
                // Пытаемся переподключиться с экспоненциальной задержкой
                if (familyChat.reconnectAttempts < familyChat.maxReconnectAttempts) {
                    const delay = Math.pow(2, familyChat.reconnectAttempts) * 1000;
                    familyChat.reconnectAttempts++;
                    
                    document.getElementById('fc_messages').innerHTML += 
                        `<div class="error">Соединение потеряно. Пытаемся переподключиться через ${delay/1000} секунд...</div>`;
                    
                    setTimeout(familyChat.initWebSocket, delay);
                } else {
                    document.getElementById('fc_messages').innerHTML += 
                        '<div class="error">Не удалось восстановить соединение. Пожалуйста, обновите страницу.</div>';
                }
            };
        };
        
        familyChat.fetchUsers = async function() {
            try {
                const response = await fetch('/api/users');
                if (!response.ok) throw new Error('Ошибка сервера');
                return await response.json();
            } catch (error) {
                console.error('Ошибка загрузки пользователей:', error);
                return [];
            }
        };

        familyChat.loadChatHistory = async function() {
            const messagesDiv = document.getElementById('fc_messages');
            
            if ((familyChat.currentChat.type === 'private' && !familyChat.currentChat.recipient) ||
                (familyChat.currentChat.type === 'group' && familyChat.currentChat.recipient)) {
                return;
            }
            
            const loadingIndicator = '<div class="system-msg">Загрузка истории...</div>';
            
            if (familyChat.currentChat.type === 'group') {
                messagesDiv.innerHTML = loadingIndicator;
            }
            
            if (familyChat.currentChat.type === 'private' && familyChat.currentChat.recipient) {
                if (familyChat.privateChatsCache[familyChat.currentChat.recipient]) {
                    familyChat.ui.displayCachedMessages();
                    // Отмечаем сообщения как прочитанные при открытии чата
                    familyChat.markMessagesAsRead(familyChat.currentChat.recipient);
                    return;
                }
                messagesDiv.innerHTML = loadingIndicator;
            }
            
            let url = `/api/messages?chatType=${familyChat.currentChat.type}`;
            if (familyChat.currentChat.type === 'private' && familyChat.currentChat.recipient) {
                url += `&withUser=${familyChat.currentChat.recipient}`;
            }
            
            try {
                const response = await fetch(url);
                const messages = await response.json();
                messagesDiv.innerHTML = '';
                
                if (messages.length === 0) {
                    messagesDiv.innerHTML = '<div class="system-msg">Нет сообщений</div>';
                } else {
                    for (const msg of messages) {
                        if (msg.message_type === 'text') {
                            familyChat.ui.handleChatMessage(msg);
                        }
                    }
                    
                    if (familyChat.currentChat.type === 'private' && familyChat.currentChat.recipient) {
                        familyChat.privateChatsCache[familyChat.currentChat.recipient] = messages;
                        // Отмечаем сообщения как прочитанные при открытии чата
                        familyChat.markMessagesAsRead(familyChat.currentChat.recipient);
                    }
                }
            } catch (error) {
                console.error('Ошибка загрузки истории:', error);
                messagesDiv.innerHTML = '<div class="error">Ошибка загрузки истории</div>';
            }
        };
        
        familyChat.sendMessage = async function() {
            const messageInput = document.getElementById('fc_messageInput');
            const message = messageInput.value.trim();
            
            if (message && familyChat.ws) {
                let data = {
                    type: 'chat',
                    text: message
                };
                
                if (familyChat.currentChat.type === 'private' && familyChat.currentChat.recipient) {
                    data.chatType = 'private';
                    data.recipient = familyChat.currentChat.recipient;
                }
                
                familyChat.ws.send(JSON.stringify(data));
                messageInput.value = '';
            }
        };
        
        familyChat.markMessagesAsRead = function(sender) {
            if (familyChat.currentChat.type === 'private' && familyChat.ws) {
                familyChat.ws.send(JSON.stringify({
                    type: 'mark_read',
                    sender: sender,
                    chatType: 'private'
                }));
            }
        };
        
        // Обработчики для определения видимости страницы
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // Страница снова активна, проверяем соединение
                if (!familyChat.ws || familyChat.ws.readyState !== WebSocket.OPEN) {
                    familyChat.initWebSocket();
                }
            }
        });
        
        // Обработчик для определения онлайн/оффлайн статуса
        window.addEventListener('online', () => {
            document.getElementById('fc_messages').innerHTML += 
                '<div class="system-msg">Соединение восстановлено</div>';
            familyChat.initWebSocket();
        });
        
        window.addEventListener('offline', () => {
            document.getElementById('fc_messages').innerHTML += 
                '<div class="error">Потеряно интернет-соединение</div>';
        });
        
        familyChat.checkSession();
    });
})();