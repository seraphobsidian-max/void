const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    const token = req.cookies.void_token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
}

function optionalAuth(req, res, next) {
    const token = req.cookies.void_token;
    if (!token) {
        req.userId = null;
        return next();
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
    } catch (err) {
        req.userId = null;
    }
    next();
}

module.exports = { requireAuth, optionalAuth };
