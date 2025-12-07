// backend/controllers/userController.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const { encrypt } = require('../utils/encryption');

// @desc    Get current user profile & bot status
// @route   GET /api/user/me
// @access  Private
const getMe = async (req, res) => {
    try {
        const userQuery = await pool.query(
            'SELECT id, email, full_name, country, phone_number FROM users WHERE id = $1',
            [req.user.id]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userQuery.rows[0];

        // Check if user has bots
        const botQuery = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1',
            [req.user.id]
        );

        // [NEW] Check if user has connected an exchange
        const exchangeQuery = await pool.query(
            'SELECT 1 FROM user_exchanges WHERE user_id = $1 LIMIT 1',
            [req.user.id]
        );

        res.json({
            user: user,
            profileComplete: !!user.full_name,
            botCreated: botQuery.rows.length > 0,
            hasExchange: exchangeQuery.rows.length > 0 // <--- Sending this to frontend
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
// @desc    Update User Profile
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

// @desc    Add Exchange Key (Manual Connection)
// @route   POST /api/user/exchange
// @access  Private
const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret } = req.body;

    try {
        // SECURITY FIX: Encrypt keys before saving
        const encryptedKey = encrypt(api_key);
        const encryptedSecret = encrypt(api_secret);

        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret, connection_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.id, exchange_name, encryptedKey, encryptedSecret, 'manual']
        );

        res.json(newExchange.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Redirect user to Exchange OAuth Page
// @route   GET /api/user/exchange/auth/:exchange
const authExchange = (req, res) => {
    const { exchange } = req.params;
    const { token } = req.query;

    let userId;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
    } catch (e) {
        return res.status(401).send("Unauthorized request");
    }

    const callbackUrl = `${process.env.API_BASE_URL}/user/exchange/callback/${exchange}`;
    let redirectUrl = "";

    if (exchange === 'binance') {
        const clientId = process.env.BINANCE_OAUTH_CLIENT_ID;
        redirectUrl = `https://accounts.binance.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${userId}`;
    } 
    else if (exchange === 'okx') {
        const clientId = process.env.OKX_OAUTH_CLIENT_ID;
        redirectUrl = `https://www.okx.com/account/users/authorization?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${userId}`;
    }

    if (redirectUrl) {
        res.redirect(redirectUrl);
    } else {
        res.status(400).send("Exchange OAuth not supported yet for " + exchange);
    }
};

// @desc    Handle callback from Exchange
// @route   GET /api/user/exchange/callback/:exchange
const authExchangeCallback = async (req, res) => {
    const { exchange } = req.params;
    const { code, state } = req.query;

    if (!code || !state) return res.status(400).send("Invalid callback data");

    try {
        // MOCK OAUTH LOGIC (Replace with real token fetch in production)
        const access_token = "mock_access_token_" + code.substring(0, 10);
        const refresh_token = "mock_refresh_token_" + code.substring(0, 10);

        await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, access_token, refresh_token, connection_type) VALUES ($1, $2, $3, $4, $5)',
            [state, exchange, access_token, refresh_token, 'oauth']
        );

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/bot-builder?step=3`);

    } catch (err) {
        console.error(err);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/bot-builder?error=oauth_failed`);
    }
};

// @desc    Create Bot & Subscription
// @route   POST /api/user/bot
// @access  Private
const createBot = async (req, res) => {
    const { bot_name, quote_currency, bot_type, plan, billing_cycle } = req.body;

    try {
        // 1. Create Subscription
        await pool.query(
            'INSERT INTO subscriptions (user_id, plan_type, billing_cycle) VALUES ($1, $2, $3) RETURNING subscription_id',
            [req.user.id, plan, billing_cycle]
        );

        // 2. Get the latest exchange connection
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

// @desc    Get Dashboard Data
// @route   GET /api/user/dashboard
// @access  Private
const getDashboard = async (req, res) => {
    try {
        // 1. Fetch User's Real Bots
        const botsQuery = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // 2. DATA FIX: Send Zeros instead of Mock Data
        // This ensures the frontend shows "$0.00" until the trading engine runs.
        const dashboardStats = [
            { 
                title: "Today's Profit", 
                value: "$0.00", 
                percentage: "0.00%", 
                isPositive: true 
            },
            { 
                title: "30 Days Profit", 
                value: "$0.00", 
                percentage: "0.00%", 
                isPositive: true 
            },
            { 
                title: "Assets Value", 
                value: "$0.00", 
                percentage: "0.00%", 
                isPositive: true 
            },
        ];

        res.json({
            stats: dashboardStats,
            bots: botsQuery.rows
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    authExchange, 
    authExchangeCallback,
    getDashboard
};
