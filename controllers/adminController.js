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
        // Fetch users along with their active subscription info
        const query = `
            SELECT u.id, u.full_name, u.email, u.role, u.created_at, u.is_verified,
                   s.plan_type, s.end_date
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
            ORDER BY u.created_at DESC
        `;
        const users = await pool.query(query);

        // Transform data to match UI requirements
        const formattedUsers = users.rows.map(user => ({
            id: user.id, // Keep original ID (e.g., uuid or number)
            user_id_display: `U-${String(user.id).padStart(4, '0')}`, // Display format U-1001
            full_name: user.full_name,
            email: user.email,
            // Logic: If plan_type exists, use it. Else 'Free'.
            plan: user.plan_type || 'Free',
            // Logic: Format date if exists
            plan_expiry: user.end_date ? new Date(user.end_date).toISOString().split('T')[0] : null,
            status: user.is_verified ? 'Active' : 'Suspended', // Logic: Verified = Active
            registered: new Date(user.created_at).toISOString().split('T')[0], // YYYY-MM-DD
            last_login: new Date(user.created_at).toLocaleString(), // Placeholder until we track login time
            role: user.role
        }));

        res.json(formattedUsers);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc Delete User
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc Update User
const updateUser = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { full_name, role, status, plan, plan_expiry } = req.body;

        // 1. Fetch current user
        const userQuery = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        if (userQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'User not found' });
        }
        const currentUser = userQuery.rows[0];

        // 2. Update Basic Info
        let isVerified = currentUser.is_verified;
        if (status === 'Active') isVerified = true;
        if (status === 'Suspended') isVerified = false;

        const newName = full_name || currentUser.full_name;
        const newRole = role || currentUser.role;

        await client.query(
            'UPDATE users SET full_name = $1, role = $2, is_verified = $3 WHERE id = $4',
            [newName, newRole, isVerified, id]
        );

        // 3. Update Subscription (Plan & Expiry)
        if (plan) {
            // Check if subscription exists
            const subCheck = await client.query('SELECT * FROM subscriptions WHERE user_id = $1', [id]);

            if (plan === 'Free') {
                // If setting to Free, we might want to "deactivate" any active paid plan, or just set it to Free.
                // Here we just upsert 'Free' with no end date.
                if (subCheck.rows.length > 0) {
                    await client.query(
                        'UPDATE subscriptions SET plan_type = $1, end_date = $2, status = $3, billing_cycle = $4 WHERE user_id = $5',
                        ['Free', null, 'active', 'monthly', id]
                    );
                } else {
                    // Create Free record
                    await client.query(
                        'INSERT INTO subscriptions (user_id, plan_type, status, billing_cycle) VALUES ($1, $2, $3, $4)',
                        [id, 'Free', 'active', 'monthly']
                    );
                }
            } else {
                // Update to Paid Plan (Pro/Basic)
                const expiryDate = plan_expiry ? new Date(plan_expiry) : null;

                if (subCheck.rows.length > 0) {
                    await client.query(
                        'UPDATE subscriptions SET plan_type = $1, end_date = $2, status = $3, billing_cycle = $4 WHERE user_id = $5',
                        [plan, expiryDate, 'active', 'monthly', id]
                    );
                } else {
                    await client.query(
                        'INSERT INTO subscriptions (user_id, plan_type, end_date, status, billing_cycle) VALUES ($1, $2, $3, $4, $5)',
                        [id, plan, expiryDate, 'active', 'monthly']
                    );
                }
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'User updated successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
};

// @desc Get System Logs (Backend + Gridbot)
const getSystemLogs = async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const util = require('util');
        const readFile = util.promisify(fs.readFile);
        const readdir = util.promisify(fs.readdir);

        let allLogs = [];

        // 1. Read Backend Logs
        const backendLogPath = path.join(__dirname, '../logs/system.log');
        if (fs.existsSync(backendLogPath)) {
            const content = await readFile(backendLogPath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim() !== '');
            const backendLogs = lines.map((line, index) => {
                // Regex to extract [Timestamp] [Level] Message
                const match = line.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
                if (match) {
                    return {
                        id: `be-${index}`,
                        timestamp: match[1],
                        service: 'Backend',
                        level: match[2],
                        message: match[3]
                    };
                }
                return null;
            }).filter(log => log !== null);
            allLogs = [...allLogs, ...backendLogs];
        }

        // 2. Read Gridbot Logs (Assuming standard directory structure)
        const gridbotLogDir = path.join(__dirname, '../../gridbot/logs');
        if (fs.existsSync(gridbotLogDir)) {
            const files = await readdir(gridbotLogDir);
            const logFiles = files.filter(f => f.endsWith('.log'));

            for (const file of logFiles) {
                const content = await readFile(path.join(gridbotLogDir, file), 'utf8');
                const lines = content.split('\n').filter(line => line.trim() !== '');

                const gridLogs = lines.map((line, index) => {
                    // Try to parse standard python formats or custom gridbot formats
                    // Often: Timestamp - Level - Message OR just Message
                    // For now, let's assume lines starting with Date like 2025- or similar
                    // or just capture the whole line

                    // Simple parser attempt for YYYY-MM-DD HH:mm:ss regex
                    const timeMatch = line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
                    const timestamp = timeMatch ? timeMatch[0] : new Date().toISOString(); // Fallback

                    let level = 'INFO';
                    if (line.includes('ERROR') || line.includes('CRITICAL')) level = 'ERROR';
                    else if (line.includes('WARNING')) level = 'WARNING';

                    return {
                        id: `gb-${file}-${index}`,
                        timestamp: timestamp,
                        service: 'Gridbot',
                        level: level,
                        message: line
                    };
                });
                allLogs = [...allLogs, ...gridLogs];
            }
        }

        // 3. Sort by Timestamp DESC
        allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // 4. Limit to recent 200 logs to prevent overload
        const limitedLogs = allLogs.slice(0, 500);

        res.json(limitedLogs);

    } catch (err) {
        console.error("Log Fetch Error:", err);
        res.status(500).send('Server Error fetching logs');
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

module.exports = { getOverview, getUsers, getAdminBots, deleteUser, updateUser, getSystemLogs };