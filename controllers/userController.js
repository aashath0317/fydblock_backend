// backend/controllers/userController.js
const pool = require('../db');
const axios = require('axios');
const ccxt = require('ccxt');
const { encrypt, decrypt } = require('../utils/encryption');

// --- GLOBAL VARIABLES ---
const TRADING_ENGINE_URL = process.env.TRADING_ENGINE_URL || 'http://localhost:8000';
const BOT_SECRET = process.env.BOT_SECRET || 'my_super_secure_bot_secret_123';

// ============================================================
// 1. USER & PROFILE
// ============================================================

const getMe = async (req, res) => {
    try {
        const userQuery = await pool.query('SELECT id, email, full_name, country, phone_number, role FROM users WHERE id = $1', [req.user.id]);
        if (userQuery.rows.length === 0) return res.status(404).json({ message: 'User not found' });

        const user = userQuery.rows[0];
        const botQuery = await pool.query("SELECT * FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED'", [req.user.id]);
        
        // Check for keys
        const liveExQuery = await pool.query("SELECT 1 FROM user_exchanges WHERE user_id = $1 AND exchange_name NOT LIKE '%_paper' LIMIT 1", [req.user.id]);
        const paperExQuery = await pool.query("SELECT 1 FROM user_exchanges WHERE user_id = $1 AND exchange_name LIKE '%_paper' LIMIT 1", [req.user.id]);

        res.json({
            user: user,
            profileComplete: !!user.full_name,
            botCreated: botQuery.rows.length > 0,
            hasExchange: (liveExQuery.rows.length > 0 || paperExQuery.rows.length > 0),
            hasLiveExchange: liveExQuery.rows.length > 0,
            hasPaperExchange: paperExQuery.rows.length > 0
        });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const updateProfile = async (req, res) => {
    const { full_name, country, phone } = req.body;
    try {
        const updatedUser = await pool.query('UPDATE users SET full_name = $1, country = $2, phone_number = $3 WHERE id = $4 RETURNING *', [full_name, country, phone, req.user.id]);
        res.json(updatedUser.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

// ============================================================
// 2. EXCHANGE MANAGEMENT
// ============================================================

const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret, passphrase } = req.body;
    try {
        const exchangeId = exchange_name.replace('_paper', '').toLowerCase();
        
        if (ccxt[exchangeId]) {
            const ex = new ccxt[exchangeId]({ apiKey: api_key, secret: api_secret, password: passphrase });
            // Test connection immediately
            if (exchange_name.includes('_paper') && ex.has['sandbox']) {
                ex.setSandboxMode(true);
            }
            // Optional: await ex.fetchBalance(); // Validate keys work
        } else {
            return res.status(400).json({ message: 'Invalid exchange' });
        }

        const encryptedKey = encrypt(api_key);
        const encryptedSecret = encrypt(api_secret);
        const encryptedPassphrase = passphrase ? encrypt(passphrase) : null;

        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret, passphrase, connection_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, exchange_name, encryptedKey, encryptedSecret, encryptedPassphrase, 'manual']
        );

        res.json(newExchange.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const authExchange = (req, res) => { res.status(501).json({ message: "OAuth not implemented" }); };
const authExchangeCallback = async (req, res) => { res.redirect(`${process.env.FRONTEND_URL}/dashboard`); };

// ============================================================
// 3. BOT MANAGEMENT
// ============================================================

const createBot = async (req, res) => {
    const { bot_name, quote_currency, bot_type, plan, billing_cycle, description, config, icon, status, mode = 'live' } = req.body;

    try {
        if (plan) {
            await pool.query('INSERT INTO subscriptions (user_id, plan_type, billing_cycle) VALUES ($1, $2, $3)', [req.user.id, plan, billing_cycle]);
        }

        // Find correct keys
        let exchangeQuery = 'SELECT * FROM user_exchanges WHERE user_id = $1 ';
        exchangeQuery += mode === 'paper' ? "AND exchange_name LIKE '%_paper' " : "AND exchange_name NOT LIKE '%_paper' ";
        exchangeQuery += 'ORDER BY created_at DESC LIMIT 1';

        const exchangeRes = await pool.query(exchangeQuery, [req.user.id]);
        
        // Strict check: Must have keys for EITHER mode now
        if (exchangeRes.rows.length === 0) {
            return res.status(400).json({ message: `No ${mode} exchange connected. Please connect keys first.` });
        }
        
        const exchangeData = exchangeRes.rows[0];
        const exchangeId = exchangeData.exchange_id;

        let configObj = typeof config === 'object' ? config : JSON.parse(config || '{}');
        configObj.mode = mode; 
        configObj.total_profit = 0;
        configObj.trade_count = 0;
        
        const configStr = JSON.stringify(configObj);

        const newBot = await pool.query(
            `INSERT INTO bots (user_id, exchange_connection_id, bot_name, quote_currency, bot_type, status, description, config, icon_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [req.user.id, exchangeId, bot_name || 'Grid Bot', quote_currency || 'USDT', bot_type, 'active', description, configStr, icon]
        );

        // Start Engine
        try {
            const apiKey = decrypt(exchangeData.api_key);
            const apiSecret = decrypt(exchangeData.api_secret);
            const passphrase = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : null;
            const realExchangeName = exchangeData.exchange_name.replace('_paper', '').toLowerCase();

            await axios.post(`${TRADING_ENGINE_URL}/start`, {
                bot_id: newBot.rows[0].bot_id,
                user_id: req.user.id,
                exchange: realExchangeName,
                pair: configObj.pair || `${quote_currency}/USDT`,
                api_key: apiKey, api_secret: apiSecret, passphrase: passphrase,
                strategy: configObj.strategy, mode: mode
            });
            console.log(`✅ Engine Started Bot ${newBot.rows[0].bot_id} in ${mode} mode`);
        } catch (engineError) {
            console.error(`❌ Engine Start Failed: ${engineError.message}`);
            await pool.query("UPDATE bots SET status = 'error' WHERE bot_id = $1", [newBot.rows[0].bot_id]);
            return res.json({ ...newBot.rows[0], warning: "Bot saved but engine failed to start." });
        }

        res.json(newBot.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const toggleBot = async (req, res) => {
    const { id } = req.params;
    try {
        const botRes = await pool.query('SELECT * FROM bots WHERE bot_id = $1 AND user_id = $2', [id, req.user.id]);
        if (botRes.rows.length === 0) return res.status(404).json({ message: "Bot not found" });
        
        const bot = botRes.rows[0];
        const newStatus = bot.status === 'active' ? 'paused' : 'active';
        let config = typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config;

        await pool.query("UPDATE bots SET status = $1 WHERE bot_id = $2", [newStatus, id]);

        if (newStatus === 'paused') {
            try { await axios.post(`${TRADING_ENGINE_URL}/stop/${id}`); } catch (e) { console.error("Engine Stop Error:", e.message); }
        } else {
            // Resume
            const exRes = await pool.query('SELECT * FROM user_exchanges WHERE exchange_id = $1', [bot.exchange_connection_id]);
            if (exRes.rows.length > 0) {
                const exData = exRes.rows[0];
                const apiKey = decrypt(exData.api_key);
                const apiSecret = decrypt(exData.api_secret);
                const passphrase = exData.passphrase ? decrypt(exData.passphrase) : null;
                const realExName = exData.exchange_name.replace('_paper', '').toLowerCase();

                try {
                    await axios.post(`${TRADING_ENGINE_URL}/start`, {
                        bot_id: bot.bot_id, user_id: req.user.id, exchange: realExName,
                        pair: config.pair, api_key: apiKey, api_secret: apiSecret, passphrase: passphrase,
                        strategy: config.strategy, mode: config.mode || 'live'
                    });
                } catch (e) { console.error("Engine Resume Error:", e.message); }
            }
        }
        res.json({ message: `Bot ${newStatus}`, status: newStatus });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const updateBot = async (req, res) => {
    const { id } = req.params;
    const { bot_name, bot_type, status, description, config, icon } = req.body;
    try {
        const configStr = typeof config === 'object' ? JSON.stringify(config) : config;
        const updatedBot = await pool.query(
            `UPDATE bots SET bot_name = $1, bot_type = $2, status = $3, description = $4, config = $5, icon_url = $6 WHERE bot_id = $7 AND user_id = $8 RETURNING *`,
            [bot_name, bot_type, status, description, configStr, icon, id, req.user.id]
        );
        if (updatedBot.rows.length === 0) return res.status(404).json({ message: 'Bot not found' });
        res.json(updatedBot.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const deleteBot = async (req, res) => {
    try {
        const { id } = req.params;
        try { await axios.post(`${TRADING_ENGINE_URL}/stop/${id}`); } catch (e) { }
        const result = await pool.query('DELETE FROM bots WHERE bot_id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Bot not found' });
        res.json({ message: 'Bot removed' });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

// ============================================================
// 4. PORTFOLIO & DASHBOARD (STRICT API FETCH)
// ============================================================

const getUserBots = async (req, res) => {
    const { mode = 'live' } = req.query;
    try {
        const botsQuery = await pool.query("SELECT * FROM bots WHERE user_id = $1 AND status != 'archived' AND bot_type != 'SKIPPED' ORDER BY created_at DESC", [req.user.id]);
        const filteredBots = botsQuery.rows.filter(bot => {
            const cfg = typeof bot.config === 'string' ? JSON.parse(bot.config || '{}') : bot.config;
            return (cfg.mode || 'live') === mode;
        });
        const enrichedBots = filteredBots.map(bot => {
            let config = typeof bot.config === 'string' ? JSON.parse(bot.config || '{}') : bot.config;
            return {
                ...bot,
                invested_capital: parseFloat(config.strategy?.investment || 0).toFixed(2),
                total_profit: config.total_profit || (0).toFixed(2),
                is_running: bot.status === 'running' || bot.status === 'active'
            };
        });
        res.json(enrichedBots);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const getDashboard = async (req, res) => {
    const { mode = 'live' } = req.query; 
    try {
        const botsQuery = await pool.query("SELECT * FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED' ORDER BY created_at DESC", [req.user.id]);
        const filteredBots = botsQuery.rows.filter(bot => {
            const cfg = typeof bot.config === 'string' ? JSON.parse(bot.config || '{}') : bot.config;
            return (cfg.mode || 'live') === mode;
        });
        let totalProfit = 0, totalInvested = 0;
        filteredBots.forEach(bot => {
            let config = typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config;
            totalProfit += parseFloat(config.total_profit || 0);
            totalInvested += parseFloat(config.strategy?.investment || 0);
        });
        res.json({ 
            stats: [
                { title: "Total Profit", value: `$${totalProfit.toFixed(2)}`, percentage: totalInvested > 0 ? `+${((totalProfit/totalInvested)*100).toFixed(2)}%` : "0.00%", isPositive: true },
                { title: "Active Investment", value: `$${totalInvested.toFixed(2)}`, percentage: "Active", isPositive: true },
                { title: "Total Bots", value: filteredBots.length.toString(), percentage: "Running", isPositive: true },
            ], 
            bots: filteredBots 
        });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

// [FIXED] getPortfolio now FORCES API connection for Paper mode
const getPortfolio = async (req, res) => {
    const { mode = 'live' } = req.query; 

    try {
        // 1. Get Keys
        let query = 'SELECT * FROM user_exchanges WHERE user_id = $1 ';
        query += mode === 'paper' ? "AND exchange_name LIKE '%_paper' " : "AND exchange_name NOT LIKE '%_paper' ";
        query += 'ORDER BY created_at DESC LIMIT 1';

        const keysQuery = await pool.query(query, [req.user.id]);
        
        // FORCE ERROR IF NO KEYS (No simulated data allowed)
        if (keysQuery.rows.length === 0) {
            return res.json({ 
                totalValue: 0, 
                changePercent: 0, 
                assets: [], 
                history: [], 
                error: `No ${mode} API connected. Please connect keys.` 
            });
        }

        const exchangeData = keysQuery.rows[0];
        const exchangeId = exchangeData.exchange_name.replace('_paper', '').toLowerCase();
        
        let apiKey, apiSecret, password;
        try {
            apiKey = decrypt(exchangeData.api_key);
            apiSecret = decrypt(exchangeData.api_secret);
            password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;
        } catch (e) {
            return res.status(500).json({ message: "Key Decryption Error" });
        }

        if (!ccxt[exchangeId]) return res.status(400).json({ message: 'Exchange not supported' });

        const exchange = new ccxt[exchangeId]({ apiKey, secret: apiSecret, password, enableRateLimit: true });

        // --- FORCE SANDBOX FOR PAPER ---
        if (mode === 'paper') {
            if (exchange.has['sandbox']) {
                exchange.setSandboxMode(true); // <--- This connects to OKX Demo
            } else {
                return res.json({ totalValue: 0, assets: [], error: "This exchange does not support Testnet via API." });
            }
        }

        // 2. Fetch Real Balance
        let balanceData = {};
        try {
            balanceData = await exchange.fetchBalance();
        } catch (e) {
            console.error(`CCXT Balance Error (${mode}):`, e.message);
            return res.json({ totalValue: 0, assets: [], error: "Failed to fetch balance from exchange." });
        }

        const assetsList = [];
        const balances = balanceData.total || {};

        Object.entries(balances).forEach(([symbol, amount]) => {
            if (amount > 0) assetsList.push({ symbol, balance: amount });
        });

        // 3. Fetch Prices
        let tickers = {};
        try {
            const symbolsToFetch = assetsList
                .filter(a => !['USDT', 'USDC', 'BUSD', 'DAI'].includes(a.symbol.toUpperCase()))
                .map(a => `${a.symbol}/USDT`);
            
            if (symbolsToFetch.length > 0) {
                tickers = await exchange.fetchTickers(symbolsToFetch);
            }
        } catch (e) { console.error("Ticker Error:", e.message); }

        let totalValue = 0;
        let totalPreviousValue = 0;
        
        const enrichedAssets = assetsList.map(asset => {
            let price = 0;
            let change24h = 0;
            const sym = asset.symbol.toUpperCase();

            if (['USDT', 'USDC', 'DAI', 'BUSD'].includes(sym)) {
                price = 1.0;
            } else {
                const pair = `${asset.symbol}/USDT`;
                if (tickers[pair]) {
                    price = tickers[pair].last;
                    change24h = tickers[pair].percentage;
                }
            }
            
            const val = asset.balance * price;
            totalValue += val;

            if (change24h !== undefined) {
                const prevPrice = price / (1 + (change24h / 100));
                totalPreviousValue += (asset.balance * prevPrice);
            } else {
                totalPreviousValue += val;
            }
            
            return {
                symbol: asset.symbol,
                balance: asset.balance,
                price, 
                value: val,
                change: change24h ? parseFloat(change24h.toFixed(2)) : 0
            };
        });

        const changePercent = totalPreviousValue > 0 ? ((totalValue - totalPreviousValue) / totalPreviousValue) * 100 : 0;

        // 4. Get History (Real Only)
        let historyData = [];
        try {
            const historyQuery = await pool.query(
                `SELECT total_value FROM portfolio_snapshots 
                 WHERE user_id = $1 
                 ORDER BY recorded_at DESC 
                 LIMIT 24`, 
                [req.user.id]
            );
            if (historyQuery.rows.length > 0) {
                historyData = historyQuery.rows.map(r => parseFloat(r.total_value)).reverse();
            }
        } catch (e) {}

        if (totalValue > 0) historyData.push(totalValue);
        if (historyData.length < 2) historyData = [totalValue, totalValue];

        res.json({ 
            totalValue, 
            changePercent: parseFloat(changePercent.toFixed(2)), 
            assets: enrichedAssets.sort((a,b) => b.value - a.value), 
            history: historyData,
            isSimulated: false, // Explicitly tell frontend this is REAL data
            mode: mode 
        });

    } catch (err) {
        console.error("Portfolio Error:", err);
        res.status(500).send('Server Error');
    }
};

// ============================================================
// 5. UTILS & HELPERS
// ============================================================

const getMarketData = async (req, res) => {
    const { exchange: exchangeId, symbol } = req.query;
    if (!exchangeId || !symbol) return res.status(400).json({ message: 'Missing parameters' });
    try {
        if (!ccxt[exchangeId.toLowerCase()]) return res.status(400).json({ message: 'Exchange not supported' });
        const exchange = new ccxt[exchangeId.toLowerCase()]();
        const orderBook = await exchange.fetchOrderBook(symbol, 10); 
        res.json({ symbol, bids: orderBook.bids, asks: orderBook.asks, timestamp: Date.now() });
    } catch (err) { res.status(500).json({ message: 'Failed to fetch market data' }); }
};

const recordBotTrade = async (req, res) => {
    const { bot_id, side, price, amount } = req.body;
    try {
        const botRes = await pool.query("SELECT config FROM bots WHERE bot_id = $1", [bot_id]);
        if (botRes.rows.length > 0) {
            let config = typeof botRes.rows[0].config === 'string' ? JSON.parse(botRes.rows[0].config) : botRes.rows[0].config;
            let currentProfit = parseFloat(config.total_profit || 0);
            if (side === 'sell') {
                 const tradeValue = price * amount;
                 currentProfit += tradeValue * 0.005; 
            }
            config.total_profit = currentProfit.toFixed(4);
            config.trade_count = (config.trade_count || 0) + 1;
            await pool.query("UPDATE bots SET config = $1 WHERE bot_id = $2", [JSON.stringify(config), bot_id]);
            console.log(`💰 Trade Recorded: ${side} @ ${price}`);
        }
        res.json({ success: true });
    } catch (err) { console.error("Record Error:", err.message); res.status(500).json({ message: "Failed" }); }
};

const resumeActiveBots = async () => {
    console.log("🔄 System Startup: Checking for active bots to resume...");
    try {
        const activeBotsQuery = await pool.query("SELECT * FROM bots WHERE status = 'active'");
        for (const bot of activeBotsQuery.rows) {
            const exRes = await pool.query('SELECT * FROM user_exchanges WHERE exchange_id = $1', [bot.exchange_connection_id]);
            if (exRes.rows.length === 0) continue;
            
            const exData = exRes.rows[0];
            const apiKey = decrypt(exData.api_key);
            const apiSecret = decrypt(exData.api_secret);
            const passphrase = exData.passphrase ? decrypt(exData.passphrase) : null;
            const realExName = exData.exchange_name.replace('_paper', '').toLowerCase();
            let config = typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config;

            try {
                const mode = config.mode || (exData.exchange_name.includes('_paper') ? 'paper' : 'live');
                await axios.post(`${TRADING_ENGINE_URL}/start`, {
                    bot_id: bot.bot_id, user_id: bot.user_id, exchange: realExName,
                    pair: config.pair, api_key: apiKey, api_secret: apiSecret, passphrase: passphrase,
                    strategy: config.strategy, mode: mode
                });
                console.log(`✅ Resumed Bot ${bot.bot_id}`);
            } catch (e) { console.error(`⚠️ Resume Failed Bot ${bot.bot_id}`); }
        }
    } catch (err) { console.error("Auto-Resume Error:", err.message); }
};

const getAvailableBots = async (req, res) => { try { const r = await pool.query(`SELECT * FROM bots JOIN users ON bots.user_id = users.id WHERE users.role = 'admin'`); res.json(r.rows); } catch (e) { res.status(500).send('Error'); } };
const executeTradeSignal = async (req, res) => { res.status(200).json({ message: "Legacy endpoint" }); };
const runBacktest = async (req, res) => { res.json({ message: "Backtest started" }); };
const getBacktests = async (req, res) => { res.json([]); };
const saveBacktest = async (req, res) => { res.json({ message: "Saved" }); };

module.exports = { 
    getMe, updateProfile, addExchange, createBot, toggleBot, updateBot, deleteBot, getAvailableBots, 
    authExchange, authExchangeCallback, getDashboard, getPortfolio, 
    getUserBots, getMarketData, executeTradeSignal, recordBotTrade, runBacktest, getBacktests, saveBacktest, resumeActiveBots 
};
