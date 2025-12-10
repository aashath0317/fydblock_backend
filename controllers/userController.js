// backend/controllers/userController.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const ccxt = require('ccxt');
const { encrypt, decrypt } = require('../utils/encryption');

// --- GLOBAL VARIABLES ---
let priceCache = { data: {}, lastFetch: 0 };
const TRADING_ENGINE_URL = process.env.TRADING_ENGINE_URL || 'http://localhost:8000';
const BOT_SECRET = process.env.BOT_SECRET || 'my_super_secure_bot_secret_123';

// 1. Fetch Crypto Prices (Cached)
const fetchTokenPrices = async (symbols) => {
    if (symbols.length === 0) return {};
    
    const CACHE_DURATION = 60 * 1000; // 1 minute
    const now = Date.now();

    if (now - priceCache.lastFetch < CACHE_DURATION && Object.keys(priceCache.data).length > 0) {
        return priceCache.data;
    }

    const symbolMap = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin',
        'USDC': 'usd-coin', 'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
        'AVAX': 'avalanche-2', 'TRX': 'tron', 'SHIB': 'shiba-inu', 'LINK': 'chainlink'
    };

    const assetIds = symbols.map(s => symbolMap[s] || s.toLowerCase()).join(',');

    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetIds}&vs_currencies=usd&include_24hr_change=true`;
        const res = await axios.get(url);
        
        priceCache.data = res.data;
        priceCache.lastFetch = now;
        return res.data;
    } catch (err) {
        console.error("CoinGecko Error:", err.message);
        return priceCache.data || {};
    }
};

// 2. Calculate Total User Portfolio Value
const calculateUserTotalValue = async (userId) => {
    const keysQuery = await pool.query(
        'SELECT * FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
    );
    if (keysQuery.rows.length === 0) return 0;

    const exchangeData = keysQuery.rows[0];
    const exchangeId = exchangeData.exchange_name.toLowerCase();
    const apiKey = decrypt(exchangeData.api_key);
    const apiSecret = decrypt(exchangeData.api_secret);
    const password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

    if (!ccxt[exchangeId]) return 0;

    const exchange = new ccxt[exchangeId]({
        apiKey, secret: apiSecret, password, enableRateLimit: true,
    });

    try {
        const tradingBalance = await exchange.fetchBalance();
        let balances = {};
        
        if (tradingBalance.total) {
            for (const [symbol, amount] of Object.entries(tradingBalance.total)) {
                if (amount > 0) balances[symbol] = amount;
            }
        }

        // Add Funding Account Balance (specific to OKX/KuCoin)
        if (exchangeId === 'okx') {
            try {
                const fundingBalance = await exchange.fetchBalance({ type: 'funding' });
                if (fundingBalance.total) {
                    for (const [symbol, amount] of Object.entries(fundingBalance.total)) {
                        balances[symbol] = (balances[symbol] || 0) + amount;
                    }
                }
            } catch (e) { /* Ignore funding error */ }
        }

        const assetsList = Object.entries(balances).map(([symbol, balance]) => ({ symbol, balance }));
        if (assetsList.length === 0) return 0;

        const symbols = assetsList.map(a => a.symbol);
        const prices = await fetchTokenPrices(symbols);
        let totalValue = 0;

        const symbolMap = { 
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana', 
            'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano'
        };

        assetsList.forEach(asset => {
            const coinId = symbolMap[asset.symbol] || asset.symbol.toLowerCase();
            const priceData = prices[coinId] || { usd: 0 };
            totalValue += asset.balance * priceData.usd;
        });

        return totalValue;

    } catch (err) {
        console.error(`Calc Error User ${userId}:`, err.message);
        return 0;
    }
};

// ============================================================
// CONTROLLERS
// ============================================================

// @desc    Get current user profile
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
        // Filter out SKIPPED bots so user appears "new" if they skipped setup
        const botQuery = await pool.query("SELECT * FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED'", [req.user.id]);
        const exchangeQuery = await pool.query('SELECT 1 FROM user_exchanges WHERE user_id = $1 LIMIT 1', [req.user.id]);

        res.json({
            user: user,
            profileComplete: !!user.full_name,
            botCreated: botQuery.rows.length > 0,
            hasExchange: exchangeQuery.rows.length > 0
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update User Profile
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

// @desc    Add Exchange Key
const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret, passphrase } = req.body;

    try {
        const exchangeId = exchange_name.toLowerCase();
        // Validation connection using CCXT
        if (ccxt[exchangeId]) {
            const exchange = new ccxt[exchangeId]({ apiKey: api_key, secret: api_secret, password: passphrase });
            // await exchange.fetchBalance(); // Optional: Test connection
        }

        const encryptedKey = encrypt(api_key);
        const encryptedSecret = encrypt(api_secret);
        const encryptedPassphrase = passphrase ? encrypt(passphrase) : null;

        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret, passphrase, connection_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, exchange_name, encryptedKey, encryptedSecret, encryptedPassphrase, 'manual']
        );

        res.json(newExchange.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Redirect to OAuth
const authExchange = (req, res) => {
    // ... (Implementation depends on specific exchange OAuth flow)
    res.status(501).json({ message: "Not implemented yet" });
};

const authExchangeCallback = async (req, res) => {
    // ... (Implementation depends on specific exchange OAuth flow)
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
};

// @desc    Create Bot
const createBot = async (req, res) => {
    const { bot_name, quote_currency, bot_type, plan, billing_cycle, description, config, icon, status } = req.body;

    try {
        if (plan) {
            await pool.query(
                'INSERT INTO subscriptions (user_id, plan_type, billing_cycle) VALUES ($1, $2, $3)',
                [req.user.id, plan, billing_cycle]
            );
        }

        const exchange = await pool.query(
            'SELECT exchange_id FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        const exchangeId = exchange.rows.length > 0 ? exchange.rows[0].exchange_id : null;

        const newBot = await pool.query(
            `INSERT INTO bots 
            (user_id, exchange_connection_id, bot_name, quote_currency, bot_type, status, description, config, icon_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING *`,
            [
                req.user.id, exchangeId, bot_name || 'My New Bot', quote_currency || 'USDT', 
                bot_type, status || 'ready', description, config, icon
            ]
        );

        // Optional: If status is 'active', trigger the Python engine here
        // if (status === 'active') { await startPythonBot(newBot.rows[0]); }

        res.json(newBot.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update Bot (Config & Icon)
const updateBot = async (req, res) => {
    const { id } = req.params;
    const { bot_name, bot_type, status, description, config, icon } = req.body;

    try {
        const updatedBot = await pool.query(
            `UPDATE bots 
             SET bot_name = $1, bot_type = $2, status = $3, description = $4, config = $5, icon_url = $6
             WHERE bot_id = $7 AND user_id = $8
             RETURNING *`,
            [bot_name, bot_type, status, description, config, icon, id, req.user.id]
        );

        if (updatedBot.rows.length === 0) {
            return res.status(404).json({ message: 'Bot not found or unauthorized' });
        }

        res.json(updatedBot.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Delete Bot
const deleteBot = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Optional: Tell Python engine to stop
        try {
            await axios.post(`${TRADING_ENGINE_URL}/stop/${id}`);
        } catch (e) { console.log("Engine stop signal failed (bot might not be running)"); }

        // 2. Delete from DB
        const result = await pool.query(
            'DELETE FROM bots WHERE bot_id = $1 AND user_id = $2 RETURNING *',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Bot not found or unauthorized' });
        }

        res.json({ message: 'Bot removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Dashboard Data (Excludes Skipped Bots)
const getDashboard = async (req, res) => {
    try {
        const botsQuery = await pool.query(
            "SELECT * FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED' ORDER BY created_at DESC",
            [req.user.id]
        );

        const dashboardStats = [
            { title: "Today's Profit", value: "$0.00", percentage: "0.00%", isPositive: true },
            { title: "30 Days Profit", value: "$0.00", percentage: "0.00%", isPositive: true },
            { title: "Assets Value", value: "$0.00", percentage: "0.00%", isPositive: true },
        ];

        res.json({ stats: dashboardStats, bots: botsQuery.rows });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get All User Bots (Excludes Skipped Bots)
const getUserBots = async (req, res) => {
    try {
        const botsQuery = await pool.query(
            "SELECT * FROM bots WHERE user_id = $1 AND status != 'archived' AND bot_type != 'SKIPPED' ORDER BY created_at DESC",
            [req.user.id]
        );

        // Add mock performance data for UI visualization
        const enrichedBots = botsQuery.rows.map(bot => ({
            ...bot,
            total_profit: (Math.random() * 100).toFixed(2),
            invested_capital: (Math.random() * 1000 + 100).toFixed(2),
            is_running: bot.status === 'running' || bot.status === 'active'
        }));

        res.json(enrichedBots);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get System Bots (Available Bots created by Admin)
const getAvailableBots = async (req, res) => {
    try {
        const query = `
            SELECT b.* FROM bots b
            JOIN users u ON b.user_id = u.id
            WHERE u.role = 'admin' AND b.status = 'active'
            ORDER BY b.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Portfolio Data
const getPortfolio = async (req, res) => {
    try {
        const keysQuery = await pool.query('SELECT * FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
        if (keysQuery.rows.length === 0) return res.json({ totalValue: 0, changePercent: 0, assets: [], history: [] });

        const exchangeData = keysQuery.rows[0];
        const exchangeId = exchangeData.exchange_name.toLowerCase();
        const apiKey = decrypt(exchangeData.api_key);
        const apiSecret = decrypt(exchangeData.api_secret);
        const password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

        if (!ccxt[exchangeId]) return res.status(400).json({ message: 'Exchange not supported' });

        const exchange = new ccxt[exchangeId]({ apiKey, secret: apiSecret, password, enableRateLimit: true });
        
        let balances = {};
        try {
            const trading = await exchange.fetchBalance();
            if (trading.total) Object.entries(trading.total).forEach(([s, a]) => { if (a > 0) balances[s] = a; });
        } catch (e) {
            return res.status(500).json({ message: 'Error fetching balance' });
        }

        const assetsList = Object.entries(balances).map(([s, b]) => ({ symbol: s, balance: b }));
        const prices = await fetchTokenPrices(assetsList.map(a => a.symbol));

        let totalValue = 0;
        const enrichedAssets = assetsList.map(asset => {
            const price = prices[asset.symbol.toLowerCase()]?.usd || 0;
            const val = asset.balance * price;
            totalValue += val;
            return {
                symbol: asset.symbol, balance: asset.balance, price, value: val,
                icon: `https://cryptologos.cc/logos/${asset.symbol.toLowerCase()}-${asset.symbol.toLowerCase()}-logo.png`
            };
        });

        res.json({ totalValue, changePercent: 0, assets: enrichedAssets, history: [] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Public Market Data
const getMarketData = async (req, res) => {
    const { exchange: exchangeId, symbol } = req.query;
    if (!exchangeId || !symbol) return res.status(400).json({ message: 'Missing parameters' });

    try {
        if (!ccxt[exchangeId.toLowerCase()]) return res.status(400).json({ message: 'Exchange not supported' });
        const exchange = new ccxt[exchangeId.toLowerCase()]();
        const orderBook = await exchange.fetchOrderBook(symbol, 10); 
        res.json({ symbol, bids: orderBook.bids, asks: orderBook.asks, timestamp: Date.now() });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch market data' });
    }
};

// --- PYTHON ENGINE INTEGRATION ---

// @desc    Execute Trade Signal (Called BY Python Bot)
const executeTradeSignal = async (req, res) => {
    const { secret, userId, exchange: exchangeName, symbol, side, amount, type } = req.body;

    if (secret !== BOT_SECRET) {
        return res.status(401).json({ message: "Unauthorized: Invalid Bot Secret" });
    }

    try {
        const keysQuery = await pool.query(
            'SELECT * FROM user_exchanges WHERE user_id = $1 AND exchange_name = $2 LIMIT 1',
            [userId, exchangeName]
        );

        if (keysQuery.rows.length === 0) return res.status(404).json({ message: "Exchange keys not found" });

        const exchangeData = keysQuery.rows[0];
        const exchangeId = exchangeData.exchange_name.toLowerCase();
        const apiKey = decrypt(exchangeData.api_key);
        const apiSecret = decrypt(exchangeData.api_secret);
        const password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

        const exchange = new ccxt[exchangeId]({ apiKey, secret: apiSecret, password, enableRateLimit: true });
        const order = await exchange.createOrder(symbol, type || 'market', side, amount);

        console.log(`[Python Signal] Executed ${side} ${symbol} for User ${userId}`);
        res.json({ success: true, orderId: order.id, details: order });

    } catch (err) {
        console.error("Signal Execution Error:", err.message);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Run Backtest (Calls Python Engine)
const runBacktest = async (req, res) => {
    try {
        const { pair, startDate, capital, upperPrice, lowerPrice, gridSize } = req.body;

        const response = await axios.post(`${TRADING_ENGINE_URL}/backtest`, {
            exchange: 'binance', 
            pair, startDate, capital, upperPrice, lowerPrice, gridSize
        });

        res.json(response.data);
    } catch (err) {
        console.error("Backtest Error:", err.message);
        res.status(500).json({ message: "Failed to run backtest simulation" });
    }
};

// @desc    Get Backtest History
const getBacktests = async (req, res) => {
    try {
        // Mock data for now, replace with DB query if you save results
        res.json([
            { id: 1, pair: 'SOL/USDT', strategy: 'Spot Grid', profit: 2350, date: 'Dec 6, 10:10 AM' }
        ]);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

// @desc    Save Backtest
const saveBacktest = async (req, res) => {
    res.json({ message: "Backtest saved" });
};

module.exports = { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    updateBot, 
    deleteBot,
    getAvailableBots, 
    authExchange, 
    authExchangeCallback, 
    getDashboard, 
    getPortfolio, 
    calculateUserTotalValue,
    getUserBots,
    getMarketData, 
    executeTradeSignal, // For Python -> Node
    runBacktest,        // For Node -> Python
    getBacktests,  
    saveBacktest   
};
