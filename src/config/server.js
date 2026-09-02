require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// --- Socket.io real-time (private + group chat foundation) ---
io.use((socket, next) => {
    const cookies = socket.handshake.headers.cookie;
    if (!cookies) return next(new Error('Not authenticated'));
    const match = cookies.match(/void_token=([^;]+)/);
    if (!match) return next(new Error('Not authenticated'));
    try {
        const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
    } catch (err) {
        next(new Error('Invalid session'));
    }
});

io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    pool.query('UPDATE users SET is_online = TRUE WHERE id = $1', [socket.userId]).catch(console.error);

    socket.on('join_conversation', (conversationId) => {
        socket.join(`conversation:${conversationId}`);
    });

    socket.on('send_message', async ({ conversationId, content, mediaUrl, mediaType }) => {
        try {
            const result = await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, content, media_url, media_type)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
                [conversationId, socket.userId, content || '', mediaUrl || null, mediaType || null]
            );
            const sender = await pool.query('SELECT username, display_name, profile_picture FROM users WHERE id = $1', [socket.userId]);

            const message = {
                id: result.rows[0].id,
                conversationId,
                senderId: socket.userId,
                sender: sender.rows[0],
                content,
                mediaUrl,
                mediaType,
                createdAt: result.rows[0].created_at
            };

            io.to(`conversation:${conversationId}`).emit('new_message', message);
        } catch (err) {
            console.error('Send message error:', err);
            socket.emit('message_error', { error: 'Failed to send message' });
        }
    });

    socket.on('disconnect', async () => {
        try {
            await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [socket.userId]);
        } catch (err) {
            console.error('Disconnect update error:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Void server running on port ${PORT}`);
});
