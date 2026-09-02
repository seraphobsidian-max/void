const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

// REGISTER
router.post('/register',
    body('username').trim().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username must be 3-32 chars, letters/numbers/underscore only'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const { username, password } = req.body;

        try {
            const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: 'Username already taken' });
            }

            const passwordHash = await bcrypt.hash(password, 12);
            const result = await pool.query(
                `INSERT INTO users (username, password_hash, display_name)
                 VALUES ($1, $2, $1) RETURNING id, username, display_name`,
                [username, passwordHash]
            );

            const user = result.rows[0];
            const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.cookie('void_token', token, cookieOptions);
            res.status(201).json({ user });
        } catch (err) {
            console.error('Register error:', err);
            res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }
    }
);

// LOGIN
router.post('/login',
    body('username').trim().notEmpty(),
    body('password').notEmpty(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const { username, password } = req.body;

        try {
            const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
            if (result.rows.length === 0) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            const user = result.rows[0];
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            await pool.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = $1', [user.id]);

            const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.cookie('void_token', token, cookieOptions);
            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    display_name: user.display_name,
                    profile_picture: user.profile_picture,
                    cover_photo: user.cover_photo,
                    is_premium: user.is_premium,
                    accent_color: user.accent_color,
                    accent_color_secondary: user.accent_color_secondary,
                    banner_animated: user.banner_animated,
                    is_admin: user.is_admin
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }
    }
);

// LOGOUT
router.post('/logout', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [req.userId]);
        res.clearCookie('void_token');
        res.json({ success: true });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// CURRENT USER
router.get('/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, display_name, bio, profile_picture, cover_photo,
                    is_premium, accent_color, accent_color_secondary, banner_animated, is_admin, created_at
             FROM users WHERE id = $1`,
            [req.userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
