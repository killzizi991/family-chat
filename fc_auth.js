const fs = require('fs');
const path = require('path');
const { db } = require('./fc_database');

const DATA_FILE = path.join(__dirname, 'fc_auth_data.json');

let fc_authCodes = [];
let fc_registeredUsers = {};
let fc_activeSessions = {};

function loadAuthData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const { users, codes, sessions } = JSON.parse(data);
            fc_registeredUsers = users || {};
            fc_authCodes = codes || [];
            fc_activeSessions = sessions || {};
            console.log("Данные аутентификации загружены.");
            
            Object.keys(fc_registeredUsers).forEach(username => {
                const code = fc_registeredUsers[username];
                db.run(
                    `INSERT OR IGNORE INTO fc_users (username, code) VALUES (?, ?)`,
                    [username, code],
                    (err) => {
                        if (err) {
                            console.error("Ошибка добавления пользователя:", err);
                        }
                    }
                );
            });
        } else {
            console.log("Файл данных не найден. Инициализация новых данных.");
            fc_generateAccessCodes();
            saveAuthData();
        }
    } catch (e) {
        console.error("Ошибка загрузки данных:", e);
    }
}

function saveAuthData() {
    try {
        const data = JSON.stringify({
            users: fc_registeredUsers,
            codes: fc_authCodes,
            sessions: fc_activeSessions
        }, null, 2);
        fs.writeFileSync(DATA_FILE, data);
        console.log("Данные аутентификации сохранены.");
    } catch (e) {
        console.error("Ошибка сохранения данных:", e);
    }
}

function fc_generateAccessCodes() {
    const codes = new Set();
    while (codes.size < 15) {
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        codes.add(code);
    }
    fc_authCodes = Array.from(codes);
    console.log("Коды доступа сгенерированы:", fc_authCodes);
}

function fc_registerUser(username, code) {
    if (fc_registeredUsers[username]) {
        return { success: false, message: "Имя пользователя уже занято" };
    }
    
    if (!fc_authCodes.includes(code)) {
        return { success: false, message: "Неверный код доступ" };
    }
    
    fc_registeredUsers[username] = code;
    fc_invalidateCode(code);
    saveAuthData();
    
    db.run(`
        INSERT OR IGNORE INTO fc_users (username, code) 
        VALUES (?, ?)
    `, [username, code], (err) => {
        if (err) console.error("Ошибка добавления пользователя:", err);
    });
    
    return { 
        success: true, 
        message: "Регистрация успешна",
        username: username
    };
}

function fc_loginUser(username, code) {
    const storedCode = fc_registeredUsers[username];
    if (!storedCode) {
        return { success: false, message: "Пользователь не найден" };
    }
    
    if (storedCode !== code) {
        return { success: false, message: "Неверный код" };
    }
    
    const sessionId = 'fc_' + Date.now() + Math.random().toString(36).substr(2, 9);
    fc_activeSessions[sessionId] = username;
    saveAuthData();
    
    return { 
        success: true, 
        message: "Вход выполнен",
        sessionId: sessionId
    };
}

function fc_logoutUser(sessionId) {
    if (fc_activeSessions[sessionId]) {
        delete fc_activeSessions[sessionId];
        saveAuthData();
        return true;
    }
    return false;
}

function fc_invalidateCode(code) {
    const index = fc_authCodes.indexOf(code);
    if (index !== -1) {
        fc_authCodes.splice(index, 1);
        saveAuthData();
    }
}

function fc_validateSession(sessionId) {
    return fc_activeSessions[sessionId] || null;
}

loadAuthData();

module.exports = {
    fc_registerUser,
    fc_loginUser,
    fc_logoutUser,
    fc_validateSession
};