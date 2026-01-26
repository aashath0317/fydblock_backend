const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');

const runMigration = async () => {
    try {
        console.log("Running Settings Columns Migration...");
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const columns = [
                { name: 'language', type: 'VARCHAR(10) DEFAULT \'en\'' },
                { name: 'timezone', type: 'VARCHAR(50) DEFAULT \'UTC\'' },
                { name: 'avatar_url', type: 'TEXT' },
                { name: 'preferences', type: 'JSONB DEFAULT \'{}\'' }
            ];

            for (const col of columns) {
                const check = await client.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name=$1`,
                    [col.name]
                );

                if (check.rows.length === 0) {
                    console.log(`Adding column: ${col.name}`);
                    await client.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
                } else {
                    console.log(`Column ${col.name} already exists. Skipped.`);
                }
            }

            await client.query('COMMIT');
            console.log("Migration completed successfully.");
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Migration Failed:", err.message);
    } finally {
        // Allow time for logs to flush if needed
        setTimeout(() => process.exit(0), 1000);
    }
};

runMigration();
