// backend/controllers/adminController.js
const pool = require('../db');

// @desc Get Admin Overview Stats
const getOverview = async (req, res) => {
    try {
        // Real counts
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const botCount = await pool.query('SELECT COUNT(*) FROM bots');
        
        // Mock data for UI visualization matching the image
        const stats = {
            totalUsers: parseInt(userCount.rows[0].count),
            revenue: 12500500, // Matching image
            activeSessions: 1250,
            systemActivity: [ // Mock data for line chart
                { time: '10am', login: 40, api: 24 },
                { time: '11am', login: 30, api: 18 },
                { time: '12pm', login: 45, api: 35 },
                { time: '1pm', login: 25, api: 20 },
                { time: '2pm', login: 35, api: 28 },
                { time: '3pm', login: 50, api: 40 },
            ],
            recentLogs: [
                { id: 1, time: '10:00:32 AM', action: 'Complete user action', user: '$132', status: 'Success' },
                { id: 2, time: '10:00:32 AM', action: 'Remote API Calls', user: '$132', status: 'Failed' },
                { id: 3, time: '10:00:32 AM', action: 'Complete user action', user: '$132', status: 'Success' },
                { id: 4, time: '10:00:32 AM', action: 'Remote API Calls', user: '$132', status: 'Success' },
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
        res.status(500).send('Server Error');
    }
};

// @desc Get Admin Bots (The 4 Bots)
const getAdminBots = async (req, res) => {
    // Hardcoded to match your requirement of "now we have 4 bots"
    const bots = [
        { id: 1, name: 'Alpha Bot', status: 'Active', performance: '+31.29%', profit: '31.29 Jwrs', uptime: '1 ms', type: 'DCA' },
        { id: 2, name: 'Beta Trader', status: 'Paused', performance: 'Frausing', profit: '13.36 Jwrs', uptime: '0 ms', type: 'Grid' },
        { id: 3, name: 'Gamma Scout', status: 'Active', performance: '0%', profit: '12.22 Jwrs', uptime: '0 ms', type: 'Futures' },
        { id: 4, name: 'Delta Exec', status: 'Active', performance: 'Paused', profit: '13.02 Jwrs', uptime: '0 ms', type: 'Arbitrage' }
    ];
    res.json(bots);
};

module.exports = { getOverview, getUsers, getAdminBots };
