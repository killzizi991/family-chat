window.familyChat = window.familyChat || {};

(function() {
    familyChat.ui = {
        handleChatMessage: function(msg) {
            const messagesDiv = document.getElementById('fc_messages');
            const isCurrentUser = msg.username === familyChat.currentUser;
            const messageId = `msg_${msg.id}`;
            
            const messageElement = document.createElement('div');
            messageElement.id = messageId;
            messageElement.className = `message ${isCurrentUser ? 'own-message' : ''}`;
            
            let statusHTML = '';
            if (msg.chatType === 'private' && isCurrentUser && msg.read) {
                statusHTML = `<span class="message-status">✓✓</span>`;
            }
            
            messageElement.innerHTML = `
                <span class="username">${msg.username}:</span>
                <span class="text">${msg.text}</span>
                ${msg.is_edited ? '<span class="edited">(изменено)</span>' : ''}
                <span class="timestamp">${familyChat.ui.formatTime(msg.timestamp)}</span>
                ${statusHTML}
            `;
            
            if (isCurrentUser && !msg.is_deleted) {
                familyChat.ui.addActionButtons(messageElement, msg.id);
            }
            
            messagesDiv.appendChild(messageElement);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        },
        
        formatTime: function(timestamp) {
            const date = new Date(timestamp);
            date.setHours(date.getHours() + 3);
            return date.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: 'Europe/Moscow'
            });
        },
        
        editMessage: function(elementId, messageId) {
            const messageElement = document.getElementById(elementId);
            const textElement = messageElement.querySelector('.text');
            const currentText = textElement.textContent;
            const originalContent = messageElement.innerHTML;
            
            const editInput = document.createElement('input');
            editInput.type = 'text';
            editInput.value = currentText;
            editInput.className = 'edit-input';
            editInput.focus();
            
            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Сохранить';
            saveBtn.className = 'edit-save-btn';
            saveBtn.onclick = () => {
                const newText = editInput.value.trim();
                if (newText && newText !== currentText) {
                    familyChat.ws.send(JSON.stringify({
                        type: 'edit',
                        messageId: messageId,
                        newText: newText
                    }));
                }
                messageElement.innerHTML = originalContent;
                familyChat.ui.addActionButtons(messageElement, messageId);
            };
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Отмена';
            cancelBtn.className = 'edit-cancel-btn';
            cancelBtn.onclick = () => {
                messageElement.innerHTML = originalContent;
                familyChat.ui.addActionButtons(messageElement, messageId);
            };
            
            const editContainer = document.createElement('div');
            editContainer.className = 'edit-container';
            editContainer.appendChild(editInput);
            editContainer.appendChild(saveBtn);
            editContainer.appendChild(cancelBtn);
            
            messageElement.innerHTML = '';
            messageElement.appendChild(editContainer);
        },
        
        addActionButtons: function(messageElement, messageId) {
            const btnContainer = document.createElement('div');
            btnContainer.className = 'message-actions';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn';
            editBtn.textContent = '✏️';
            editBtn.onclick = () => familyChat.ui.editMessage(messageElement.id, messageId);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = () => familyChat.ui.deleteOwnMessage(messageElement.id, messageId);
            
            btnContainer.appendChild(editBtn);
            btnContainer.appendChild(deleteBtn);
            messageElement.appendChild(btnContainer);
        },
        
        updateMessage: function(data) {
            const messageElement = document.getElementById(`msg_${data.id}`);
            if (!messageElement) return;
            
            let statusHTML = '';
            if (data.chatType === 'private' && data.username === familyChat.currentUser && data.read) {
                statusHTML = `<span class="message-status">✓✓</span>`;
            }
            
            messageElement.innerHTML = `
                <span class="username">${data.username}:</span>
                <span class="text">${data.text}</span>
                <span class="edited">(изменено)</span>
                <span class="timestamp">${familyChat.ui.formatTime(data.timestamp)}</span>
                ${statusHTML}
            `;
            
            if (data.username === familyChat.currentUser) {
                familyChat.ui.addActionButtons(messageElement, data.id);
            }
        },
        
        markAllMessagesAsRead: function(chatWith) {
            if (familyChat.currentChat.type === 'private' && 
                familyChat.currentChat.recipient === chatWith) {
                const messageElements = document.querySelectorAll('.message.own-message');
                messageElements.forEach(element => {
                    const statusElement = element.querySelector('.message-status');
                    if (statusElement) {
                        statusElement.textContent = '✓✓';
                    } else {
                        const newStatus = document.createElement('span');
                        newStatus.className = 'message-status';
                        newStatus.textContent = '✓✓';
                        element.appendChild(newStatus);
                    }
                });
            }
        },
        
        deleteOwnMessage: function(elementId, messageId) {
            if (confirm('Удалить сообщение?')) {
                familyChat.ws.send(JSON.stringify({
                    type: 'delete',
                    messageId: messageId
                }));
            }
        },
        
        deleteMessage: function(messageId) {
            const messageElement = document.getElementById(`msg_${messageId}`);
            if (!messageElement) return;
            
            messageElement.innerHTML = `
                <span class="deleted-msg">Сообщение удалено</span>
                <span class="timestamp">${familyChat.ui.formatTime(new Date())}</span>
            `;
            messageElement.className = 'message deleted-message';
        },
        
        displayCachedMessages: function() {
            const messages = familyChat.privateChatsCache[familyChat.currentChat.recipient];
            const messagesDiv = document.getElementById('fc_messages');
            messagesDiv.innerHTML = '';
            
            if (messages.length === 0) {
                messagesDiv.innerHTML = '<div class="system-msg">Нет сообщений</div>';
                return;
            }
            
            messages.forEach(msg => {
                if (msg.message_type === 'text') {
                    familyChat.ui.handleChatMessage(msg);
                }
            });
        },
        
        updateOnlineStatus: function(onlineUsers) {
            const chatItems = document.querySelectorAll('.chat-item[data-username]');
            chatItems.forEach(item => {
                const username = item.dataset.username;
                const statusIndicator = item.querySelector('.online-status');
                
                if (onlineUsers.includes(username)) {
                    statusIndicator.classList.add('online');
                } else {
                    statusIndicator.classList.remove('online');
                }
            });
        },
        
        updateUnreadCounts: function(counts) {
            familyChat.unreadCounts = counts;
            
            const chatItems = document.querySelectorAll('.chat-item[data-username]');
            chatItems.forEach(item => {
                const username = item.dataset.username;
                const count = counts[username] || 0;
                
                const oldBadge = item.querySelector('.unread-badge');
                if (oldBadge) {
                    oldBadge.remove();
                }
                
                if (count > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    badge.textContent = count;
                    badge.style.cssText = `
                        background: #007bff;
                        color: white;
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 12px;
                        margin-left: auto;
                    `;
                    item.appendChild(badge);
                }
            });
        },
        
        initChatList: async function() {
            const chatsContainer = document.getElementById('fc_chatsContainer');
            chatsContainer.innerHTML = '';
    
            const groupChat = document.createElement('div');
            groupChat.className = 'chat-item';
            groupChat.innerHTML = '<span>👥</span> Групповой чат';
            groupChat.dataset.chatType = 'group';
            
            groupChat.addEventListener('click', () => {
                familyChat.currentChat = { type: 'group', recipient: null };
                document.getElementById('fc_chatTitle').textContent = "Общий чат";
                familyChat.loadChatHistory();
                
                const sidebar = document.getElementById('fc_sidebar');
                sidebar.classList.remove('active');
                if (window.innerWidth > 768) {
                    sidebar.classList.add('collapsed');
                }
            });
            chatsContainer.appendChild(groupChat);
    
            const users = await familyChat.fetchUsers();
            users.forEach(user => {
                const userElement = document.createElement('div');
                userElement.className = 'chat-item';
                userElement.innerHTML = `
                    <span class="online-status"></span>
                    <span>👤</span> ${user}
                `;
                userElement.dataset.username = user;
                
                if (familyChat.onlineUsers.includes(user)) {
                    userElement.querySelector('.online-status').classList.add('online');
                }
                
                const unreadCount = familyChat.unreadCounts[user] || 0;
                if (unreadCount > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    badge.textContent = unreadCount;
                    badge.style.cssText = `
                        background: #007bff;
                        color: white;
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 12px;
                        margin-left: auto;
                    `;
                    userElement.appendChild(badge);
                }
                
                userElement.addEventListener('click', () => {
                    familyChat.currentChat = { 
                        type: 'private', 
                        recipient: user 
                    };
                    document.getElementById('fc_chatTitle').textContent = `Чат с ${user}`;
                    familyChat.loadChatHistory();
                    
                    const sidebar = document.getElementById('fc_sidebar');
                    sidebar.classList.remove('active');
                    if (window.innerWidth > 768) {
                        sidebar.classList.add('collapsed');
                    }
                });
                chatsContainer.appendChild(userElement);
            });
        },
        
        initEventListeners: function() {
            const loginForm = document.getElementById('fc_loginForm');
            const registerForm = document.getElementById('fc_registerForm');
            const registerLink = document.getElementById('fc_registerLink');
            const backToLoginLink = document.getElementById('fc_backToLogin');
            const logoutButton = document.getElementById('fc_logoutButton');
            const sendButton = document.getElementById('fc_sendButton');
            const messageInput = document.getElementById('fc_messageInput');
            const menuToggle = document.getElementById('fc_menuToggle');
            const collapseSidebar = document.getElementById('fc_collapseSidebar');
            
            if (collapseSidebar) {
                collapseSidebar.addEventListener('click', () => {
                    const sidebar = document.getElementById('fc_sidebar');
                    sidebar.classList.toggle('collapsed');
                });
            }
            
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await familyChat.ui.handleLogin();
            });
            
            document.getElementById('fc_loginUsername').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    familyChat.ui.handleLogin();
                }
            });
            
            document.getElementById('fc_loginCode').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    familyChat.ui.handleLogin();
                }
            });
            
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('fc_registerUsername').value;
                const code = document.getElementById('fc_registerCode').value;
                
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, code })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Регистрация успешна! Теперь войдите.');
                    registerForm.style.display = 'none';
                    loginForm.style.display = 'block';
                } else {
                    alert(`Ошибка: ${result.message}`);
                }
            });
            
            registerLink.addEventListener('click', (e) => {
                e.preventDefault();
                loginForm.style.display = 'none';
                registerForm.style.display = 'block';
            });
            
            backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                registerForm.style.display = 'none';
                loginForm.style.display = 'block';
            });
            
            logoutButton.addEventListener('click', async () => {
                const response = await fetch('/api/logout', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    if (familyChat.ws) familyChat.ws.close();
                    document.getElementById('fc_chatContainer').style.display = 'none';
                    loginForm.style.display = 'block';
                    document.getElementById('fc_messages').innerHTML = '';
                    familyChat.currentUser = null;
                    familyChat.privateChatsCache = {};
                    alert('Вы вышли из системы');
                } else {
                    alert('Ошибка выхода');
                }
            });
            
            sendButton.addEventListener('click', familyChat.sendMessage);
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') familyChat.sendMessage();
            });
            
            menuToggle.addEventListener('click', () => {
                const sidebar = document.getElementById('fc_sidebar');
                sidebar.classList.toggle('active');
            });
            
            document.addEventListener('click', (e) => {
                const sidebar = document.getElementById('fc_sidebar');
                const menuToggle = document.getElementById('fc_menuToggle');
                const isMobile = window.innerWidth <= 768;
                const isDesktopCollapsed = window.innerWidth > 768 && sidebar.classList.contains('collapsed');
                
                if (sidebar.contains(e.target) || e.target === menuToggle) {
                    return;
                }
                
                if (isMobile && sidebar.classList.contains('active')) {
                    sidebar.classList.remove('active');
                }
                else if (!isMobile && !isDesktopCollapsed) {
                    sidebar.classList.add('collapsed');
                }
            });
        },
        
        handleLogin: async function() {
            const username = document.getElementById('fc_loginUsername').value;
            const code = document.getElementById('fc_loginCode').value;
            
            if (!username || !code) {
                alert('Заполните все поля');
                return;
            }
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, code })
                });
                
                const result = await response.json();
                if (result.success) {
                    familyChat.currentUser = username;
                    document.getElementById('fc_currentUser').textContent = familyChat.currentUser;
                    familyChat.initWebSocket();
                    document.getElementById('fc_loginForm').style.display = 'none';
                    document.getElementById('fc_registerForm').style.display = 'none';
                    document.getElementById('fc_chatContainer').style.display = 'flex';
                    document.getElementById('fc_messages').innerHTML += '<div class="system-msg">Вы подключены к чату</div>';
                    await familyChat.ui.initChatList();
                    familyChat.loadChatHistory();
                } else {
                    alert(`Ошибка: ${result.message}`);
                }
            } catch (error) {
                console.error('Ошибка входа:', error);
                alert('Произошла ошибка при входе. Проверьте консоль для подробностей.');
            }
        },

        addCallButton: function() {
            if (familyChat.currentChat.type === 'private' && familyChat.currentChat.recipient) {
                const callButton = document.createElement('button');
                callButton.id = 'fc_startCall';
                callButton.textContent = '📞';
                callButton.title = 'Начать звонок';
                callButton.style.cssText = `
                    background: none;
                    border: none;
                    font-size: 1.5em;
                    cursor: pointer;
                    margin-left: 10px;
                `;
                
                const chatHeader = document.getElementById('fc_chatHeader');
                if (!document.getElementById('fc_startCall')) {
                    chatHeader.appendChild(callButton);
                }
            } else {
                const callButton = document.getElementById('fc_startCall');
                if (callButton) callButton.remove();
            }
        },

        createCallInterface: function() {
            if (document.getElementById('fc_callContainer')) return;
            
            const callContainer = document.createElement('div');
            callContainer.id = 'fc_callContainer';
            callContainer.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 0 20px rgba(0,0,0,0.3);
                z-index: 2000;
                display: none;
                width: 300px;
                text-align: center;
            `;
            
            callContainer.innerHTML = `
                <div id="fc_callStatus">Статус звонка</div>
                <div style="margin: 15px 0;">
                    <video id="fc_localVideo" autoplay muted style="width: 100px; height: 75px; border: 1px solid #ccc;"></video>
                    <video id="fc_remoteVideo" autoplay style="width: 200px; height: 150px; border: 1px solid #ccc;"></video>
                </div>
                <div id="fc_callControls" style="margin: 10px 0;">
                    <button id="fc_endCall" style="background: #f44336; color: white; border: none; padding: 10px; border-radius: 5px; cursor: pointer;">Завершить</button>
                </div>
                <div id="fc_incomingCall" style="display: none; margin: 10px 0;">
                    <button id="fc_acceptCall" style="background: #4CAF50; color: white; border: none; padding: 10px; margin-right: 10px; border-radius: 5px; cursor: pointer;">Принять</button>
                    <button id="fc_rejectCall" style="background: #f44336; color: white; border: none; padding: 10px; border-radius: 5px; cursor: pointer;">Отклонить</button>
                </div>
            `;
            
            document.body.appendChild(callContainer);
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        familyChat.ui.initEventListeners();
        familyChat.ui.createCallInterface();
        
        setInterval(() => {
            familyChat.ui.addCallButton();
        }, 1000);
    });
})();