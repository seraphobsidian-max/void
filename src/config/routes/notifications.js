const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT n.id, n.type, n.is_read, n.created_at, n.post_id, n.conversation_id,
                    a.id as actor_id, a.username as actor_username, a.display_name as actor_display_name,
                    a.profile_picture as actor_profile_picture
             FROM notifications n
             JOIN users a ON n.actor_id = a.id
             WHERE n.user_id = $1
             ORDER BY n.created_at DESC LIMIT 50`,
            [req.userId]
        );
        res.json({ notifications: result.rows });
    } catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

router.post('/read', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Mark read error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

router.get('/unread-count', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE', [req.userId]);
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Unread count error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
