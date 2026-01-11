const pool = require('./db');

const migrate = async () => {
    try {
        console.log("Starting migration: Adding end_date to subscriptions...");
        await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS end_date TIMESTAMP;');
        console.log("Success: Added end_date column to subscriptions.");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err.message);
        process.exit(1);
    }
};

migrate();
