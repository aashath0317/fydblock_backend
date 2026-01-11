const pool = require('./db');

const updateUsers = async () => {
    try {
        console.log("Updating all users to Active (Verified)...");
        const res = await pool.query("UPDATE users SET is_verified = TRUE");
        console.log(`Success: Updated ${res.rowCount} users to Verified status.`);
        process.exit(0);
    } catch (err) {
        console.error("Update failed:", err.message);
        process.exit(1);
    }
};

updateUsers();
