const { Pool } = require('pg');

const pool = new Pool({
    user: 'fydblock_user',
    password: 'Akeel0317@',
    host: 'localhost',
    port: 5432,
    database: 'fydblock_db'
});

const migrate = async () => {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if column exists
            const res = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='users' AND column_name='profile_complete';
            `);

            if (res.rows.length === 0) {
                console.log("Adding profile_complete column...");
                await client.query(`
                    ALTER TABLE users 
                    ADD COLUMN profile_complete BOOLEAN DEFAULT FALSE;
                `);

                console.log("Migrating existing users...");
                // Set profile_complete = TRUE for users who already have a full_name
                await client.query(`
                    UPDATE users 
                    SET profile_complete = TRUE 
                    WHERE full_name IS NOT NULL AND full_name != '';
                `);
            } else {
                console.log("Column profile_complete already exists.");
            }

            await client.query('COMMIT');
            console.log("Migration successful!");
        } catch (e) {
            await client.query('ROLLBACK');
            console.err("Migration failed:", e);
        } finally {
            client.release();
        }
    } catch (e) {
        console.error("Connection failed:", e);
    } finally {
        await pool.end();
    }
};

migrate();
