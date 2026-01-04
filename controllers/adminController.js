// backend/controllers/adminController.js
const pool = require('../db');

// @desc Get Admin Overview Stats
const getOverview = async (req, res) => {
    try {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const botCount = await pool.query('SELECT COUNT(*) FROM bots');
        
        // These stats are placeholders for the top cards
        const stats = {
            totalUsers: parseInt(userCount.rows[0].count) || 0,
            revenue: 0, 
            activeSessions: 0,
            systemActivity: [],
            recentLogs: []
        };
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc Get User List
const getUsers = async (req, res) => {
    try {
        const users = await pool.query('SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 20');
        res.json(users.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc Get Admin Bots (The critical function)
const getAdminBots = async (req, res) => {
    console.log("?? API HIT: Fetching bots from DATABASE..."); // Look for this in your terminal
    try {
        // This query asks the Database for bots. 
        // If the DB is empty, this returns [] (empty list).
        const bots = await pool.query('SELECT * FROM bots ORDER BY created_at DESC');
        
        console.log(`? Found ${bots.rows.length} bots in database.`);
        res.json(bots.rows);
    } catch (err) {
        console.error("? Database Error:", err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getOverview, getUsers, getAdminBots };