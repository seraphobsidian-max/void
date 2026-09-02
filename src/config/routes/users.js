const express = require('express');
const pool = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// GET profile by username
router.get('/:username', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, display_name, bio, profile_picture, cover_photo,
                    is_premium, accent_color, accent_color_secondary, banner_animated,
                    is_admin, is_online, last_seen, created_at
             FROM users WHERE LOWER(username) = LOWER($1)`,
            [req.params.username]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const profileUser = result.rows[0];

        const followerCount = await pool.query('SELECT COUNT(*) FROM follows WHERE following_id = $1', [profileUser.id]);
        const followingCount = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [profileUser.id]);

        let isFollowing = false;
        if (req.userId) {
            const f = await pool.query('SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2', [req.userId, profileUser.id]);
            isFollowing = f.rows.length > 0;
        }

        res.json({
            user: profileUser,
            followers: parseInt(followerCount.rows[0].count),
            following: parseInt(followingCount.rows[0].count),
            isFollowing
        });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// UPDATE own profile
router.patch('/me/update', requireAuth, async (req, res) => {
    const { display_name, bio } = req.body;
    try {
        const result = await pool.query(
            `UPDATE users SET display_name = COALESCE($1, display_name), bio = COALESCE($2, bio)
             WHERE id = $3 RETURNING id, username, display_name, bio`,
            [display_name, bio, req.userId]
        );
        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// UPLOAD profile picture
router.post('/me/pfp', requireAuth, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
        const url = `/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET profile_picture = $1 WHERE id = $2', [url, req.userId]);
        res.json({ profile_picture: url });
    } catch (err) {
        console.error('Upload pfp error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// UPLOAD cover photo
router.post('/me/cover', requireAuth, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
        const url = `/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET cover_photo = $1 WHERE id = $2', [url, req.userId]);
        res.json({ cover_photo: url });
    } catch (err) {
        console.error('Upload cover error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// SEARCH users
router.get('/', requireAuth, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ users: [] });
    try {
        const result = await pool.query(
            `SELECT id, username, display_name, profile_picture, is_premium
             FROM users WHERE username ILIKE $1 OR display_name ILIKE $1 LIMIT 20`,
            [`%${q}%`]
        );
        res.json({ users: result.rows });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// FOLLOW / UNFOLLOW
router.post('/:username/follow', requireAuth, async (req, res) => {
    try {
        const target = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [req.params.username]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const targetId = target.rows[0].id;
        if (targetId === req.userId) return res.status(400).json({ error: "You can't follow yourself" });

        const existing = await pool.query('SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2', [req.userId, targetId]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.userId, targetId]);
            return res.json({ following: false });
        } else {
            await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [req.userId, targetId]);
            await pool.query(
                `INSERT INTO notifications (user_id, type, actor_id) VALUES ($1, 'follow', $2)`,
                [targetId, req.userId]
            );
            return res.json({ following: true });
        }
    } catch (err) {
        console.error('Follow error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// BLOCK / UNBLOCK
router.post('/:username/block', requireAuth, async (req, res) => {
    try {
        const target = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [req.params.username]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const targetId = target.rows[0].id;

        const existing = await pool.query('SELECT id FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.userId, targetId]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.userId, targetId]);
            return res.json({ blocked: false });
        } else {
            await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [req.userId, targetId]);
            return res.json({ blocked: true });
        }
    } catch (err) {
        console.error('Block error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// REPORT user
router.post('/:username/report', requireAuth, async (req, res) => {
    const { reason } = req.body;
    try {
        const target = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [req.params.username]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        await pool.query(
            'INSERT INTO reports (reporter_id, reported_user_id, reason) VALUES ($1, $2, $3)',
            [req.userId, target.rows[0].id, reason || 'No reason provided']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Report error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// SUGGESTED users
router.get('/suggestions/list', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, display_name, profile_picture, is_premium
             FROM users
             WHERE id != $1
             AND id NOT IN (SELECT following_id FROM follows WHERE follower_id = $1)
             AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
             ORDER BY RANDOM() LIMIT 10`,
            [req.userId]
        );
        res.json({ users: result.rows });
    } catch (err) {
        console.error('Suggestions error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// UPDATE Void Premium customization (accent colors + animated banner flag) — premium users only
router.patch('/me/premium-customization', requireAuth, async (req, res) => {
    const { accent_color, accent_color_secondary, banner_animated } = req.body;
    const hexPattern = /^#[0-9a-fA-F]{6}$/;

    try {
        const userCheck = await pool.query('SELECT is_premium FROM users WHERE id = $1', [req.userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        if (!userCheck.rows[0].is_premium) {
            return res.status(403).json({ error: 'Void Premium required to customize accent colors and banners' });
        }

        if (accent_color && !hexPattern.test(accent_color)) {
            return res.status(400).json({ error: 'accent_color must be a valid hex code, e.g. #cf0c18' });
        }
        if (accent_color_secondary && !hexPattern.test(accent_color_secondary)) {
            return res.status(400).json({ error: 'accent_color_secondary must be a valid hex code, e.g. #0d0304' });
        }

        const result = await pool.query(
            `UPDATE users SET
                accent_color = COALESCE($1, accent_color),
                accent_color_secondary = COALESCE($2, accent_color_secondary),
                banner_animated = COALESCE($3, banner_animated)
             WHERE id = $4
             RETURNING accent_color, accent_color_secondary, banner_animated`,
            [accent_color || null, accent_color_secondary || null,
             typeof banner_animated === 'boolean' ? banner_animated : null, req.userId]
        );
        res.json({ customization: result.rows[0] });
    } catch (err) {
        console.error('Premium customization error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// GRANT / REVOKE Premium — admin (developer) only
router.post('/:username/grant-premium', requireAuth, async (req, res) => {
    try {
        const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
        if (!adminCheck.rows[0]?.is_admin) {
            return res.status(403).json({ error: 'Only the developer/admin can grant Void Premium' });
        }

        const target = await pool.query('SELECT id, is_premium FROM users WHERE LOWER(username) = LOWER($1)', [req.params.username]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const newStatus = !target.rows[0].is_premium;
        await pool.query('UPDATE users SET is_premium = $1 WHERE id = $2', [newStatus, target.rows[0].id]);

        if (newStatus) {
            await pool.query(
                `INSERT INTO notifications (user_id, type, actor_id) VALUES ($1, 'premium', $2)`,
                [target.rows[0].id, req.userId]
            );
        }

        res.json({ is_premium: newStatus });
    } catch (err) {
        console.error('Grant premium error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
