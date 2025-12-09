// backend/controllers/adminController.js
const pool = require('../db');

// @desc Get Admin Overview Stats
const getOverview = async (req, res) => {
    try {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const botCount = await pool.query('SELECT COUNT(*) FROM bots');
        
        // Mock stats for the chart (since we don't have an activity_logs table yet)
        const stats = {
            totalUsers: parseInt(userCount.rows[0].count),
            revenue: 12500500, 
            activeSessions: 1250,
            systemActivity: [ 
                { time: '10am', login: 40, api: 24 },
                { time: '11am', login: 30, api: 18 },
                { time: '12pm', login: 45, api: 35 },
                { time: '1pm', login: 25, api: 20 },
                { time: '2pm', login: 35, api: 28 },
                { time: '3pm', login: 50, api: 40 },
            ],
            recentLogs: [
                { id: 1, time: '10:00:32 AM', action: 'Complete user action', user: '$132', status: 'Success' },
                { id: 2, time: '10:00:32 AM', action: 'Remote API Calls', user: '$132', status: 'Failed' }
            ]
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

// @desc Get Admin Bots (Real DB Data)
const getAdminBots = async (req, res) => {
    try {
        // ✅ CHANGED: Now fetching from DB instead of returning fake array
        // We fetch bots belonging to the logged-in admin
        const bots = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1 ORDER BY created_at DESC', 
            [req.user.id]
        );
        
        res.json(bots.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { getOverview, getUsers, getAdminBots };
