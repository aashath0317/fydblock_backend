const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'fydblock_user',
    password: process.env.DB_PASSWORD || 'Akeel0317@',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'fydblock_db'
});

const createSessionsTable = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log("Creating user_sessions table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                session_id VARCHAR(255) UNIQUE NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                device_type VARCHAR(50),
                browser VARCHAR(50),
                os VARCHAR(50),
                location VARCHAR(100),
                is_active BOOLEAN DEFAULT TRUE,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("user_sessions table created successfully!");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Failed to create user_sessions table:", e);
    } finally {
        client.release();
        await pool.end();
    }
};

createSessionsTable();
