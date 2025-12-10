// backend/controllers/userController.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const ccxt = require('ccxt');
const { encrypt, decrypt } = require('../utils/encryption');

// --- GLOBAL VARIABLES ---
const TRADING_ENGINE_URL = process.env.TRADING_ENGINE_URL || 'http://localhost:8000';
const BOT_SECRET = process.env.BOT_SECRET || 'my_super_secure_bot_secret_123';

// ============================================================
// CONTROLLERS
// ============================================================

// @desc    Get current user profile
const getMe = async (req, res) => {
    try {
        const userQuery = await pool.query(
            'SELECT id, email, full_name, country, phone_number, role FROM users WHERE id = $1',
            [req.user.id]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userQuery.rows[0];
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
        if (ccxt[exchangeId]) {
            const exchange = new ccxt[exchangeId]({ apiKey: api_key, secret: api_secret, password: passphrase });
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

const authExchange = (req, res) => { res.status(501).json({ message: "OAuth not implemented" }); };
const authExchangeCallback = async (req, res) => { res.redirect(`${process.env.FRONTEND_URL}/dashboard`); };

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

        const configStr = typeof config === 'object' ? JSON.stringify(config) : config;

        const newBot = await pool.query(
            `INSERT INTO bots 
            (user_id, exchange_connection_id, bot_name, quote_currency, bot_type, status, description, config, icon_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING *`,
            [
                req.user.id, exchangeId, bot_name || 'My Bot', quote_currency || 'USDT', 
                bot_type, status || 'ready', description, configStr, icon
            ]
        );

        res.json(newBot.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update Bot
const updateBot = async (req, res) => {
    const { id } = req.params;
    const { bot_name, bot_type, status, description, config, icon } = req.body;

    try {
        const configStr = typeof config === 'object' ? JSON.stringify(config) : config;

        const updatedBot = await pool.query(
            `UPDATE bots 
             SET bot_name = $1, bot_type = $2, status = $3, description = $4, config = $5, icon_url = $6
             WHERE bot_id = $7 AND user_id = $8
             RETURNING *`,
            [bot_name, bot_type, status, description, configStr, icon, id, req.user.id]
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
        try {
            await axios.post(`${TRADING_ENGINE_URL}/stop/${id}`);
        } catch (e) { /* Ignore */ }

        const result = await pool.query(
            'DELETE FROM bots WHERE bot_id = $1 AND user_id = $2 RETURNING *',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Bot not found' });
        }

        res.json({ message: 'Bot removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Dashboard Data
const getDashboard = async (req, res) => {
    try {
        const botsQuery = await pool.query(
            "SELECT * FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED' ORDER BY created_at DESC",
            [req.user.id]
        );

        // Simple placeholder stats
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

// @desc    Get User Bots
const getUserBots = async (req, res) => {
    try {
        const botsQuery = await pool.query(
            "SELECT * FROM bots WHERE user_id = $1 AND status != 'archived' AND bot_type != 'SKIPPED' ORDER BY created_at DESC",
            [req.user.id]
        );

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

// @desc    Get System Bots
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

// @desc    Get Real-Time Portfolio (FIXED PRICE FETCHING)
const getPortfolio = async (req, res) => {
    try {
        // 1. Get Keys
        const keysQuery = await pool.query('SELECT * FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
        
        if (keysQuery.rows.length === 0) {
            return res.json({ totalValue: 0, changePercent: 0, assets: [], history: [] });
        }

        const exchangeData = keysQuery.rows[0];
        const exchangeId = exchangeData.exchange_name.toLowerCase();
        
        let apiKey, apiSecret, password;
        try {
            apiKey = decrypt(exchangeData.api_key);
            apiSecret = decrypt(exchangeData.api_secret);
            password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;
        } catch (e) {
            console.error("Decryption failed:", e);
            return res.status(500).json({ message: "Key Error" });
        }

        if (!ccxt[exchangeId]) return res.status(400).json({ message: 'Exchange not supported' });

        const exchange = new ccxt[exchangeId]({ apiKey, secret: apiSecret, password, enableRateLimit: true });
        
        // 2. Fetch Balance
        let balances = {};
        try {
            const trading = await exchange.fetchBalance();
            if (trading.total) {
                Object.entries(trading.total).forEach(([s, a]) => { 
                    if (a > 0) balances[s] = a; 
                });
            }
        } catch (e) {
            console.error("CCXT Balance Error:", e.message);
            return res.json({ totalValue: 0, changePercent: 0, assets: [], history: [] });
        }

        const assetsList = Object.entries(balances).map(([s, b]) => ({ symbol: s, balance: b }));
        if (assetsList.length === 0) return res.json({ totalValue: 0, changePercent: 0, assets: [], history: [] });

        // 3. ✅ FETCH PRICES FROM EXCHANGE (Not CoinGecko)
        // We create symbols like 'BTC/USDT', 'ETH/USDT' to get prices
        let tickers = {};
        try {
            const symbolsToFetch = assetsList
                .filter(a => a.symbol !== 'USDT' && a.symbol !== 'USDC') // Don't fetch price for stablecoins yet
                .map(a => `${a.symbol}/USDT`);
            
            if (symbolsToFetch.length > 0) {
                tickers = await exchange.fetchTickers(symbolsToFetch);
            }
        } catch (e) {
            console.error("CCXT Ticker Error:", e.message);
            // Continue anyway, maybe we have stablecoins
        }

        let totalValue = 0;
        
        const enrichedAssets = assetsList.map(asset => {
            let price = 0;

            // Stablecoin logic
            if (['USDT', 'USDC', 'DAI', 'BUSD'].includes(asset.symbol.toUpperCase())) {
                price = 1.0;
            } else {
                // Try to find price in tickers
                const pair = `${asset.symbol}/USDT`;
                if (tickers[pair]) {
                    price = tickers[pair].last;
                }
            }
            
            const val = asset.balance * price;
            totalValue += val;
            
            return {
                symbol: asset.symbol.toUpperCase(), 
                balance: asset.balance, 
                price, 
                value: val
            };
        });

        // Sort by value (highest first)
        enrichedAssets.sort((a, b) => b.value - a.value);

        res.json({ totalValue, changePercent: 0, assets: enrichedAssets, history: [] });

    } catch (err) {
        console.error("Portfolio Error:", err);
        res.status(500).send('Server Error');
    }
};

// @desc    Public Market Data
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

// --- PYTHON INTEGRATION ---
const executeTradeSignal = async (req, res) => {
    const { secret, userId, exchange: exchangeName, symbol, side, amount, type } = req.body;
    if (secret !== BOT_SECRET) return res.status(401).json({ message: "Unauthorized Bot Secret" });

    try {
        const keysQuery = await pool.query(
            'SELECT * FROM user_exchanges WHERE user_id = $1 AND exchange_name = $2 LIMIT 1',
            [userId, exchangeName]
        );
        if (keysQuery.rows.length === 0) return res.status(404).json({ message: "Keys not found" });

        const exchangeData = keysQuery.rows[0];
        const apiKey = decrypt(exchangeData.api_key);
        const apiSecret = decrypt(exchangeData.api_secret);
        const password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

        const exchange = new ccxt[exchangeData.exchange_name.toLowerCase()]({ apiKey, secret: apiSecret, password, enableRateLimit: true });
        const order = await exchange.createOrder(symbol, type || 'market', side, amount);

        console.log(`[Python Signal] ${side.toUpperCase()} ${symbol} for User ${userId}`);
        res.json({ success: true, orderId: order.id, details: order });
    } catch (err) {
        console.error("Signal Error:", err.message);
        res.status(500).json({ message: err.message });
    }
};

const runBacktest = async (req, res) => {
    try {
        const { pair, startDate, endDate, capital, upperPrice, lowerPrice, gridSize } = req.body;
        const response = await axios.post(`${TRADING_ENGINE_URL}/backtest`, {
            exchange: 'binance', pair, startDate, endDate, capital, upperPrice, lowerPrice, gridSize
        });
        res.json(response.data);
    } catch (err) {
        console.error("Backtest Proxy Error:", err.message);
        res.status(500).json({ message: "Backtest simulation failed" });
    }
};

const getBacktests = async (req, res) => { res.json([]); };
const saveBacktest = async (req, res) => { res.json({ message: "Backtest saved" }); };

module.exports = { 
    getMe, updateProfile, addExchange, createBot, updateBot, deleteBot, getAvailableBots, 
    authExchange, authExchangeCallback, getDashboard, getPortfolio, 
    getUserBots, getMarketData, executeTradeSignal, runBacktest, getBacktests, saveBacktest   
};
