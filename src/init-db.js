require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function init() {
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);
        console.log('✅ Void database schema initialized successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Database init failed:', err);
        process.exit(1);
    }
}

init();
