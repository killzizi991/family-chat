const { db } = require('./fc_database');

function fc_cleanupOldMessages() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.setMonth(now.getMonth() - 6));
    const timestamp = sixMonthsAgo.toISOString();

    db.all(`
        SELECT id
        FROM fc_messages 
        WHERE timestamp < ? 
        AND is_deleted = 0
    `, [timestamp], (err, rows) => {
        if (err) {
            console.error('Ошибка при выборке старых сообщений:', err);
            return;
        }

        rows.forEach(row => {
            db.run(`UPDATE fc_messages SET is_deleted = 1 WHERE id = ?`, [row.id], (err) => {
                if (err) {
                    console.error(`Ошибка при удалении сообщения ID ${row.id}:`, err);
                }
            });
        });
        console.log(`Удалено ${rows.length} старых сообщений.`);
    });
}

module.exports = {
    fc_cleanupOldMessages
};