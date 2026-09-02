const express = require('express');
const pool = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

const POST_SELECT = `
    SELECT p.id, p.content, p.media_url, p.media_type, p.created_at, p.updated_at,
           u.id as user_id, u.username, u.display_name, u.profile_picture, u.is_premium,
           u.accent_color, u.accent_color_secondary,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
`;

// CREATE post
router.post('/', requireAuth, upload.single('media'), async (req, res) => {
    const { content } = req.body;
    if (!content && !req.file) return res.status(400).json({ error: 'Post cannot be empty' });

    try {
        let mediaUrl = null, mediaType = null;
        if (req.file) {
            mediaUrl = `/uploads/${req.file.filename}`;
            mediaType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
        }
        const result = await pool.query(
            `INSERT INTO posts (user_id, content, media_url, media_type) VALUES ($1, $2, $3, $4) RETURNING id`,
            [req.userId, content || '', mediaUrl, mediaType]
        );
        res.status(201).json({ postId: result.rows[0].id });
    } catch (err) {
        console.error('Create post error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// FEED (personalized: own posts + followed users, fallback to all if none)
router.get('/feed', requireAuth, async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const result = await pool.query(
            `${POST_SELECT}
             WHERE p.user_id = $1
                OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
             AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
             ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
            [req.userId, limit, offset]
        );

        let posts = result.rows;
        // fallback: if user follows no one, show global feed
        if (posts.length === 0 && offset === 0) {
            const global = await pool.query(
                `${POST_SELECT} ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
                [limit, offset]
            );
            posts = global.rows;
        }

        const likedResult = await pool.query(
            `SELECT post_id FROM likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
            [req.userId, posts.map(p => p.id)]
        );
        const likedSet = new Set(likedResult.rows.map(r => r.post_id));
        posts = posts.map(p => ({ ...p, liked_by_me: likedSet.has(p.id) }));

        res.json({ posts });
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// GET single post
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
        res.json({ post: result.rows[0] });
    } catch (err) {
        console.error('Get post error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// EDIT post
router.patch('/:id', requireAuth, async (req, res) => {
    const { content } = req.body;
    try {
        const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [req.params.id]);
        if (post.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
        if (post.rows[0].user_id !== req.userId) return res.status(403).json({ error: 'Not your post' });

        await pool.query('UPDATE posts SET content = $1, updated_at = NOW() WHERE id = $2', [content, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Edit post error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// DELETE post
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [req.params.id]);
        if (post.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

        const isOwner = post.rows[0].user_id === req.userId;
        const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
        const isAdmin = adminCheck.rows[0]?.is_admin;

        if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not your post' });

        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete post error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// LIKE / UNLIKE
router.post('/:id/like', requireAuth, async (req, res) => {
    try {
        const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [req.params.id]);
        if (post.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

        const existing = await pool.query('SELECT id FROM likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.userId]);
            return res.json({ liked: false });
        } else {
            await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [req.params.id, req.userId]);
            if (post.rows[0].user_id !== req.userId) {
                await pool.query(
                    `INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, 'like', $2, $3)`,
                    [post.rows[0].user_id, req.userId, req.params.id]
                );
            }
            return res.json({ liked: true });
        }
    } catch (err) {
        console.error('Like error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// COMMENT on post
router.post('/:id/comments', requireAuth, async (req, res) => {
    const { content, parentCommentId } = req.body;
    if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });

    try {
        const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [req.params.id]);
        if (post.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

        const result = await pool.query(
            `INSERT INTO comments (post_id, user_id, parent_comment_id, content)
             VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
            [req.params.id, req.userId, parentCommentId || null, content]
        );

        if (post.rows[0].user_id !== req.userId) {
            await pool.query(
                `INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, 'comment', $2, $3)`,
                [post.rows[0].user_id, req.userId, req.params.id]
            );
        }

        res.status(201).json({ comment: result.rows[0] });
    } catch (err) {
        console.error('Comment error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// GET comments
router.get('/:id/comments', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.content, c.parent_comment_id, c.created_at,
                    u.id as user_id, u.username, u.display_name, u.profile_picture
             FROM comments c JOIN users u ON c.user_id = u.id
             WHERE c.post_id = $1 ORDER BY c.created_at ASC`,
            [req.params.id]
        );
        res.json({ comments: result.rows });
    } catch (err) {
        console.error('Get comments error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
