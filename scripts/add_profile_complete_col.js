const pool = require('../db');

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
                // This assumes existing users with names are 'complete' (legacy behavior)
                // The user reporting the bug will unfortunately be marked TRUE here too,
                // but we can't distinguish them programmatically easily without risking false negatives.
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
            console.error("Migration failed:", e);
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
