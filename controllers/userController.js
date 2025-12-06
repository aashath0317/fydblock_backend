// controllers/userController.js
const pool = require('../db');

// @desc    Get current user profile & bot status
// @route   GET /api/user/me
// @access  Private
const getMe = async (req, res) => {
    try {
        // Get user profile
        const userQuery = await pool.query(
            'SELECT id, email, full_name, country, phone_number FROM users WHERE id = $1',
            [req.user.id]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userQuery.rows[0];

        // Check if user has already created a bot
        const botQuery = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1',
            [req.user.id]
        );

        res.json({
            user: user,
            // Logic: Profile is "complete" if full_name is set
            profileComplete: !!user.full_name, 
            // Logic: Bot is created if a record exists
            botCreated: botQuery.rows.length > 0 
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update User Profile (Step 1)
// @route   PUT /api/user/profile
// @access  Private
const updateProfile = async (req, res) => {
    const { full_name, country, phone } = req.body;

    try {
        const updatedUser = await pool.query(
            'UPDATE users SET full_name = $1, country = $2, phone_number = $3 WHERE id = $4 RETURNING *',
            [full_name, country, phone, req.user.id]
        );

        res.json(updatedUser.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Add Exchange Key (Step 2)
// @route   POST /api/user/exchange
// @access  Private
const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret } = req.body;

    try {
        // Note: In production, encrypt api_key/secret before saving!
        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.user.id, exchange_name, api_key, api_secret]
        );

        res.json(newExchange.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Create Bot & Subscription (Step 4 & 5)
// @route   POST /api/user/bot
// @access  Private
const createBot = async (req, res) => {
    const { bot_name, quote_currency, bot_type, plan, billing_cycle } = req.body;

    try {
        // 1. Create Subscription
        const sub = await pool.query(
            'INSERT INTO subscriptions (user_id, plan_type, billing_cycle) VALUES ($1, $2, $3) RETURNING subscription_id',
            [req.user.id, plan, billing_cycle]
        );

        // 2. Get the latest exchange connection for this user (Simplified logic)
        const exchange = await pool.query(
            'SELECT exchange_id FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        
        const exchangeId = exchange.rows.length > 0 ? exchange.rows[0].exchange_id : null;

        // 3. Create Bot
        const newBot = await pool.query(
            'INSERT INTO bots (user_id, exchange_connection_id, bot_name, quote_currency, bot_type, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, exchangeId, bot_name || 'My First Bot', quote_currency, bot_type, 'ready']
        );

        res.json(newBot.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getMe, updateProfile, addExchange, createBot };
