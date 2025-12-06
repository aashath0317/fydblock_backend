// controllers/userController.js
const pool = require('../db');
const jwt = require('jsonwebtoken'); // Required for decoding tokens in OAuth flow

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

// @desc    Add Exchange Key (Manual Connection)
// @route   POST /api/user/exchange
// @access  Private
const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret } = req.body;

    try {
        // We explicitly set connection_type to 'manual'
        // SECURITY NOTE: In a real app, you MUST encrypt api_key and api_secret before saving.
        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret, connection_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.id, exchange_name, api_key, api_secret, 'manual']
        );

        res.json(newExchange.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Redirect user to Exchange OAuth Page (Fast Connect)
// @route   GET /api/user/exchange/auth/:exchange
const authExchange = (req, res) => {
    const { exchange } = req.params;
    const { token } = req.query; // Passed from frontend

    // Verify user token from query param since this is a browser redirect
    let userId;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
    } catch (e) {
        return res.status(401).send("Unauthorized request");
    }

    // Define OAuth URLs based on exchange documentation
    let redirectUrl = "";
    // Ensure API_BASE_URL is defined in your .env (e.g., http://localhost:5000/api)
    const callbackUrl = `${process.env.API_BASE_URL}/user/exchange/callback/${exchange}`; 

    if (exchange === 'binance') {
        const clientId = process.env.BINANCE_OAUTH_CLIENT_ID;
        redirectUrl = `https://accounts.binance.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${userId}`;
    } 
    else if (exchange === 'okx') {
        const clientId = process.env.OKX_OAUTH_CLIENT_ID;
        // OKX typically uses this structure, check specific docs for updates
        redirectUrl = `https://www.okx.com/account/users/authorization?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${userId}`;
    }
    // Add other exchanges (Bybit, Coinbase) logic here as needed

    if (redirectUrl) {
        res.redirect(redirectUrl);
    } else {
        res.status(400).send("Exchange OAuth not supported yet for " + exchange);
    }
};

// @desc    Handle callback from Exchange (Fast Connect Return)
// @route   GET /api/user/exchange/callback/:exchange
const authExchangeCallback = async (req, res) => {
    const { exchange } = req.params;
    const { code, state } = req.query; // 'state' contains the userId we sent earlier

    if (!code || !state) return res.status(400).send("Invalid callback data");

    try {
        // 1. Exchange 'code' for 'access_token' 
        // THIS IS MOCK LOGIC. You must implement the specific fetch call for each exchange.
        // Example for Binance:
        // const tokenResponse = await fetch('https://accounts.binance.com/oauth/token', { ... });
        // const { access_token, refresh_token } = await tokenResponse.json();
        
        // --- START MOCK DATA ---
        const access_token = "mock_access_token_" + code.substring(0, 10);
        const refresh_token = "mock_refresh_token_" + code.substring(0, 10);
        // --- END MOCK DATA ---

        // 2. Save to Database
        await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, access_token, refresh_token, connection_type) VALUES ($1, $2, $3, $4, $5)',
            [state, exchange, access_token, refresh_token, 'oauth']
        );

        // 3. Redirect back to your Frontend Bot Builder (Step 3)
        // Ensure FRONTEND_URL is in your .env (e.g., http://localhost:5173)
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/bot-builder?step=3`);

    } catch (err) {
        console.error(err);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/bot-builder?error=oauth_failed`);
    }
};

// @desc    Create Bot & Subscription (Step 4 & 5)
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

        // 2. Get the latest exchange connection for this user
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

module.exports = { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    authExchange, 
    authExchangeCallback 
};
