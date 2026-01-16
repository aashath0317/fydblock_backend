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
        const userQuery = await pool.query('SELECT id, email, full_name, country, phone_number, role, is_verified FROM users WHERE id = $1', [req.user.id]);
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
            hasPaperExchange: paperExQuery.rows.length > 0,
            is_verified: user.is_verified // New field
        });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const updateProfile = async (req, res) => {
    const { full_name, country, phone } = req.body;
    try {
        const updatedUser = await pool.query(
            `UPDATE users 
             SET full_name = COALESCE($1, full_name), 
                 country = COALESCE($2, country), 
                 phone_number = COALESCE($3, phone_number) 
             WHERE id = $4 
             RETURNING *`,
            [full_name, country, phone, req.user.id]
        );
        res.json(updatedUser.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

// 2. EXCHANGE MANAGEMENT
// ============================================================

const getSupportedExchanges = (req, res) => {
    res.json([
        { id: 'binance', name: 'Binance', required_fields: ['api_key', 'api_secret'] },
        { id: 'okx', name: 'OKX', required_fields: ['api_key', 'api_secret', 'passphrase'] },
        { id: 'kucoin', name: 'KuCoin', required_fields: ['api_key', 'api_secret', 'passphrase'] },
    ]);
};

const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret, passphrase } = req.body;
    try {
        const exchangeId = exchange_name.replace('_paper', '').toLowerCase();

        if (ccxt[exchangeId]) {
            const config = {
                apiKey: api_key,
                secret: api_secret,
                password: passphrase,
                enableRateLimit: true
            };

            const ex = new ccxt[exchangeId](config);

            // Test connection immediately
            if (exchange_name.includes('_paper')) {
                if (ex.has['sandbox']) {
                    ex.setSandboxMode(true);
                } else if (exchangeId === 'okx') {
                    // Manual OKX Sandbox
                    ex.options['sandboxMode'] = true;
                    ex.headers = ex.headers || {};
                    ex.headers['x-simulated-trading'] = '1';
                } else {
                    return res.status(400).json({ message: 'This exchange does not support Paper Trading (Sandbox).' });
                }
            }

            // Validate keys by fetching balance
            try {
                await ex.fetchBalance();
            } catch (authErr) {
                console.error(`Exchange Auth Error (${exchangeId}):`, authErr.message);
                return res.status(400).json({ message: `Authentication failed: ${authErr.message}` });
            }

        } else {
            return res.status(400).json({ message: 'Invalid exchange' });
        }

        // VERIFY KEYS WITH CCXT
        try {
            let ccxtId = exchange_name.replace('_paper', '');
            if (!ccxt[ccxtId]) {
                return res.status(400).json({ message: 'Invalid exchange name' });
            }

            const exchange = new ccxt[ccxtId]();
            exchange.apiKey = api_key;
            exchange.secret = api_secret;
            if (passphrase) exchange.password = passphrase;

            if (exchange_name.includes('_paper')) {
                exchange.setSandboxMode(true);
            }

            // Attempt to fetch balance to verify credentials
            await exchange.fetchBalance();

        } catch (verificationError) {
            console.error(`Exchange verification failed for ${exchange_name}:`, verificationError.message);
            // Return specific error message from exchange
            return res.status(400).json({ message: `Verification failed: ${verificationError.message}` });
        }

        const encryptedKey = encrypt(api_key);
        const encryptedSecret = encrypt(api_secret);
        const encryptedPassphrase = passphrase ? encrypt(passphrase) : null;

        // Check if already exists
        const existing = await pool.query(
            'SELECT * FROM user_exchanges WHERE user_id = $1 AND exchange_name = $2',
            [req.user.id, exchange_name]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                'UPDATE user_exchanges SET api_key = $1, api_secret = $2, passphrase = $3 WHERE user_id = $4 AND exchange_name = $5',
                [encryptedKey, encryptedSecret, encryptedPassphrase, req.user.id, exchange_name]
            );
            return res.json({ message: 'Exchange updated successfully' });
        }

        const newExchange = await pool.query(
            'INSERT INTO user_exchanges (user_id, exchange_name, api_key, api_secret, passphrase, connection_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, exchange_name, encryptedKey, encryptedSecret, encryptedPassphrase, 'manual']
        );

        res.json(newExchange.rows[0]);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

const deleteExchange = async (req, res) => {
    const { name } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get Exchange ID
        const exQuery = await client.query("SELECT exchange_id FROM user_exchanges WHERE user_id = $1 AND exchange_name = $2", [req.user.id, name]);
        if (exQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Exchange not found' });
        }
        const exchangeId = exQuery.rows[0].exchange_id;

        // 2. Find Associated Bots
        const botsQuery = await client.query("SELECT bot_id FROM bots WHERE user_id = $1 AND exchange_connection_id = $2", [req.user.id, exchangeId]);

        // 3. Stop & Delete Bots
        for (const bot of botsQuery.rows) {
            try {
                // Stop in Engine (fail-safe)
                await axios.delete(`${TRADING_ENGINE_URL}/bot/${bot.bot_id}`);
            } catch (e) {
                console.error(`Failed to stop bot ${bot.bot_id} on engine:`, e.message);
            }
            // Delete from DB
            await client.query("DELETE FROM bots WHERE bot_id = $1", [bot.bot_id]);
        }

        // 4. Delete Exchange
        await client.query("DELETE FROM user_exchanges WHERE exchange_id = $1", [exchangeId]);

        await client.query('COMMIT');
        res.json({ message: 'Exchange disconnected and associated bots removed.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
};

const authExchange = (req, res) => { res.status(501).json({ message: "OAuth not implemented" }); };
const authExchangeCallback = async (req, res) => { res.redirect(`${process.env.FRONTEND_URL}/dashboard`); };

const getUserExchanges = async (req, res) => {
    try {
        const result = await pool.query('SELECT exchange_name, created_at, connection_type FROM user_exchanges WHERE user_id = $1', [req.user.id]);
        res.json(result.rows);
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

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

        console.log("createBot Payload:", JSON.stringify(req.body, null, 2)); // DEBUG LOG
        let configObj = typeof config === 'object' ? config : JSON.parse(config || '{}');
        console.log("Parsed Config:", JSON.stringify(configObj, null, 2)); // DEBUG LOG

        configObj.mode = mode;
        configObj.total_profit = 0;
        configObj.trade_count = 0;

        // Extract Strategy early to check for investment there
        const strat = configObj.strategy || {};

        // ? CORRECT LOCATION: Inside the function calls
        // Fallback Sequence: config.investment -> req.body.investment -> strategy.investment
        const investmentAmount = parseFloat(configObj.investment || req.body.investment || strat.investment || 0);
        console.log("Resolved Investment Amount:", investmentAmount); // DEBUG LOG

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

            // Map Backend Logic to GridBot Pydantic Schema
            const isTestnet = mode === 'paper';

            // Extract Grid Params
            let strategy = configObj.strategy || {};
            // If strategy came as a string inside configObj
            if (typeof strategy === 'string') {
                try { strategy = JSON.parse(strategy); } catch (e) { }
            }

            await axios.post(`${TRADING_ENGINE_URL}/start`, {
                bot_id: newBot.rows[0].bot_id,
                user_id: req.user.id,
                exchange: realExchangeName,
                pair: configObj.pair || `${quote_currency}/USDT`,
                api_key: apiKey,
                api_secret: apiSecret,
                passphrase: passphrase,
                mode: isTestnet ? 'paper' : 'live',
                investment: investmentAmount,
                strategy: {
                    upper_price: parseFloat(strategy.upper_limit || strategy.upper_price || 0),
                    lower_price: parseFloat(strategy.lower_limit || strategy.lower_price || 0),
                    grids: parseInt(strategy.grid_count || strategy.grids || 10),
                    spacing: (strategy.grid_type || "ARITHMETIC").toLowerCase() === 'geometric' ? 'geometric' : 'arithmetic'
                }
            });
            console.log(`? Engine Started Bot ${newBot.rows[0].bot_id} in ${mode} mode`);
        } catch (engineError) {
            console.error(`? Engine Start Failed Details:`, engineError.response ? engineError.response.data : engineError.message);
            console.error(`? Engine Start Stack:`, engineError.stack); // ADDED FOR DEBUGGING
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
            try { await axios.post(`${TRADING_ENGINE_URL}/stop/${id}`, {}); } catch (e) { console.error("Engine Stop Error:", e.message); }
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
                    const isTestnet = config.mode === 'paper' || exData.exchange_name.includes('_paper');
                    const strategy = config.strategy || {};

                    await axios.post(`${TRADING_ENGINE_URL}/start`, {
                        bot_id: parseInt(id),
                        user_id: req.user.id,
                        exchange: realExName,
                        pair: config.pair,
                        api_key: apiKey,
                        api_secret: apiSecret,
                        passphrase: passphrase,
                        mode: isTestnet ? 'paper' : 'live',
                        investment: parseFloat(strategy.investment || 0),
                        strategy: {
                            upper_price: parseFloat(strategy.upper_limit || strategy.upper_price || 0),
                            lower_price: parseFloat(strategy.lower_limit || strategy.lower_price || 0),
                            grids: parseInt(strategy.grid_count || strategy.grids || 10),
                            spacing: (strategy.grid_type || "ARITHMETIC").toLowerCase() === 'geometric' ? 'geometric' : 'arithmetic'
                        }
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

        // 1. Fetch Keys to support Offline Liquidation
        let credsPayload = null;
        try {
            const botQuery = await pool.query('SELECT * FROM bots WHERE bot_id = $1 AND user_id = $2', [id, req.user.id]);
            if (botQuery.rows.length > 0) {
                const bot = botQuery.rows[0];
                const config = typeof bot.config === 'string' ? JSON.parse(bot.config || '{}') : bot.config;
                const strategy = config.strategy || {};

                // Get Exchange Keys
                // Get Exchange Keys - FIXED Column Name
                const exRes = await pool.query('SELECT * FROM user_exchanges WHERE exchange_id = $1', [bot.exchange_connection_id]);
                if (exRes.rows.length > 0) {
                    const exData = exRes.rows[0];
                    credsPayload = {
                        api_key: decrypt(exData.api_key),
                        api_secret: decrypt(exData.api_secret),
                        passphrase: exData.passphrase ? decrypt(exData.passphrase) : null,
                        exchange: exData.exchange_name.replace('_paper', '').toLowerCase(),
                        pair: config.pair,
                        mode: config.mode || 'live'
                    };
                }
            }
        } catch (e) {
            console.error("Failed to fetch credentials for liquidation:", e.message);
        }

        try {
            const deleteConfig = {
                params: { liquidate: true },
                data: credsPayload || {}
            };

            await axios.delete(`${TRADING_ENGINE_URL}/bot/${id}`, deleteConfig);
        } catch (e) {
            console.error("Engine Delete/Stop Error:", e.response ? e.response.data : e.message);
        }

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
        const botsQuery = await pool.query(`
            SELECT b.*, ue.exchange_name 
            FROM bots b
            LEFT JOIN user_exchanges ue ON b.exchange_connection_id = ue.exchange_id
            WHERE b.user_id = $1 AND b.status != 'archived' AND b.bot_type != 'SKIPPED'
            ORDER BY b.created_at DESC
        `, [req.user.id]);

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
    const { mode = 'live', timeframe = '1d' } = req.query; // Default to 1d
    try {
        // 1. Fetch User's Bots
        const botsQuery = await pool.query(`
            SELECT b.*, ue.exchange_name 
            FROM bots b
            LEFT JOIN user_exchanges ue ON b.exchange_connection_id = ue.exchange_id
            WHERE b.user_id = $1 AND b.bot_type != 'SKIPPED'
            ORDER BY b.created_at DESC
        `, [req.user.id]);

        const filteredBots = botsQuery.rows.filter(bot => {
            const cfg = typeof bot.config === 'string' ? JSON.parse(bot.config || '{}') : bot.config;
            return (cfg.mode || 'live') === mode;
        });


        // 2. Calculate Bot Stats (Current Totals) & Fetch Sparklines
        let totalBotProfit = 0;
        let activeInvestment = 0;

        // Use Promise.all to fetch sparklines in parallel
        await Promise.all(filteredBots.map(async (bot) => {
            let config = typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config;
            totalBotProfit += parseFloat(config.total_profit || 0);
            activeInvestment += parseFloat(config.strategy?.investment || 0);

            // Fetch last 25 snapshots for this bot for the sparkline (24h + current)
            try {
                const sparkRes = await pool.query(
                    `SELECT total_profit FROM bot_snapshots 
                     WHERE bot_id = $1 
                     ORDER BY recorded_at DESC 
                     LIMIT 25`,
                    [bot.bot_id]
                );
                // Store as [oldest, ..., newest]
                bot.sparkline = sparkRes.rows.map(r => parseFloat(r.total_profit)).reverse();
            } catch (e) {
                bot.sparkline = [];
            }
        }));

        // 3. FETCH CHART DATA (Grid Profit History)
        // Rules:
        // 1h -> Last 30 hours
        // 3h -> Last 90 hours
        // 1d -> Last 30 days
        // 1w -> Last 30 weeks
        // 1m -> Last 30 months

        // Map timeframe to SQL interval
        const timeframeMap = {
            '1h': { interval: "30 hours", step: 1 },         // Every 1 hour (as is)
            '3h': { interval: "90 hours", step: 3 },         // Every 3rd hour
            '1d': { interval: "30 days", step: 24 },         // Every 24th hour
            '1w': { interval: "30 weeks", step: 168 },       // Every 168th hour
            '1m': { interval: "30 months", step: 720 },      // Approx 720 hours (30 days)
        };

        const tfConfig = timeframeMap[timeframe] || timeframeMap['1d'];

        // Complex Query:
        // 1. Join bot_snapshots with bots to filter by user and mode.
        // 2. Group by rounded timestamp (hour) to sum profits across all bots.
        // 3. Filter by time range.
        const profitHistoryQuery = await pool.query(`
            SELECT 
                date_trunc('hour', bs.recorded_at) as snapshot_time,
                SUM(bs.total_profit) as value
            FROM bot_snapshots bs
            JOIN bots b ON bs.bot_id = b.bot_id
            WHERE b.user_id = $1 
              AND (b.config::json->>'mode')::text = $2
              AND bs.recorded_at > NOW() - $3::interval
            GROUP BY snapshot_time
            ORDER BY snapshot_time ASC
        `, [req.user.id, mode, tfConfig.interval]);

        // Downsampling in JS (Simpler than SQL modulo on timestamps)
        const rawData = profitHistoryQuery.rows;
        const chartData = [];

        // If data is empty, maybe send a single point 0? or empty array
        if (rawData.length > 0) {
            // We iterate and pick every Nth item
            // Using a simple loop
            for (let i = 0; i < rawData.length; i += tfConfig.step) {
                // Determine label format based on timeframe
                const d = new Date(rawData[i].snapshot_time);
                let label = "";
                if (timeframe === '1h' || timeframe === '3h') {
                    label = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                } else {
                    label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }

                chartData.push({
                    date: label,
                    value: parseFloat(rawData[i].value)
                });
            }
        }

        // Ensure we don't exceed 31 points (as requested "remove old snapshot of 1st one")
        // though logic above roughly yields 30.
        const finalChartData = chartData.slice(-31);


        // 4. Calculate Portfolio Stats (Assets Value & 30d PnL)
        // This comes from portfolio_snapshots (Equity)
        const tableName = mode === 'live' ? 'portfolio_snapshots_live' : 'portfolio_snapshots_paper';
        const portfolioHistoryQuery = await pool.query(
            `SELECT total_value, recorded_at FROM ${tableName} WHERE user_id = $1 ORDER BY recorded_at ASC`,
            [req.user.id]
        );
        const portfolioHistory = portfolioHistoryQuery.rows;

        const currentEquity = portfolioHistory.length > 0
            ? parseFloat(portfolioHistory[portfolioHistory.length - 1].total_value)
            : activeInvestment; // Fallback to investment

        // PnL (30d)
        let profit30d = 0;
        let profitPercent = 0;
        // Find record ~30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const oldRecord = portfolioHistory.find(p => new Date(p.recorded_at) >= thirtyDaysAgo);
        if (oldRecord) {
            const startValue = parseFloat(oldRecord.total_value);
            profit30d = currentEquity - startValue;
            if (startValue > 0) profitPercent = ((profit30d / startValue) * 100).toFixed(2);
        } else if (portfolioHistory.length > 0) {
            // If < 30 days history, use oldest
            const startValue = parseFloat(portfolioHistory[0].total_value);
            profit30d = currentEquity - startValue;
            if (startValue > 0) profitPercent = ((profit30d / startValue) * 100).toFixed(2);
        }

        // --- FINAL RESPONSE ---
        res.json({
            stats: [
                {
                    title: "Total Bot Profit",
                    value: `$${totalBotProfit.toFixed(2)}`,
                    percentage: activeInvestment > 0 ? `+${((totalBotProfit / activeInvestment) * 100).toFixed(2)}%` : "0.00%",
                    isPositive: true
                },
                {
                    title: "30 Days PnL",
                    value: `$${profit30d.toFixed(2)}`,
                    percentage: `${profitPercent}%`,
                    isPositive: profit30d >= 0
                },
                {
                    title: "Assets Value",
                    value: `$${currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                    percentage: `${filteredBots.length} Bots`,
                    isPositive: true
                },
            ],
            bots: filteredBots,
            chartData: finalChartData
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
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

        // 2a. Fetch Real-Time Allocations from Trading Engine
        // This includes Locked Orders + Internal Bot Reserves
        let reservedBalances = {};
        try {
            const engineUrl = process.env.TRADING_ENGINE_URL || "http://127.0.0.1:8000";
            console.log(`[Portfolio] Fetching Allocations... URL: ${engineUrl} Mode: ${mode}`);

            const allocRes = await axios.get(`${engineUrl}/allocations`, { params: { mode } });
            reservedBalances = allocRes.data || {};
            console.log(`[Portfolio] Engine Allocations Received:`, reservedBalances);
        } catch (e) {
            console.error("[Portfolio] Failed to fetch engine allocations:", e.message);
            if (e.response) {
                console.error("   Status:", e.response.status);
                console.error("   Data:", e.response.data);
            }
        }

        const assetsList = [];
        const balances = balanceData.total || {};
        const freeBalances = balanceData.free || {};

        Object.entries(balances).forEach(([symbol, amount]) => {
            if (amount > 0) {
                // Safer 'free' extraction from Exchange
                let exchangeFree = amount;
                if (balanceData[symbol]) {
                    if (balanceData[symbol].free !== undefined) exchangeFree = balanceData[symbol].free;
                    else if (balanceData[symbol].used !== undefined) exchangeFree = amount - balanceData[symbol].used;
                } else if (freeBalances[symbol] !== undefined) {
                    exchangeFree = freeBalances[symbol];
                }

                // Apply Reservation Logic
                // STRATEGY SPLIT:
                // 1. PAPER TRADING: 
                //    - If using simple simulator (no exchange), deduct Total.
                //    - If using Exchange Sandbox (OKX), treat as LIVE (Balance updates on exchange).
                // 2. LIVE TRADING: Exchange Balance reflects Locked orders. Deduct Idle.

                const alloc = reservedBalances[symbol] || { total: 0, idle: 0 };
                const totalReserved = alloc.total || 0;

                // DETECT GHOST ALLOCATIONS / DESYNC
                // If the Engine thinks we have MORE money reserved than exists in the account, 
                // it's a desync. We should ignore the allocation to prevent blocking the user.
                const isDesync = totalReserved > amount * 1.5; // Tolerance buffer

                // Select deduction amount
                // If OKX/Binance etc (Real API), we trust the Exchange's "Used" field -> Deduct only internal Idle
                // Unless it's a Desync, then we ignore internal allocs.
                let deductionAmount = 0;

                if (isDesync) {
                    console.warn(`[Portfolio] Desync detected for ${symbol}. Engine: ${totalReserved}, Exch: ${amount}. Ignoring allocation.`);
                    deductionAmount = 0;
                } else {
                    // For OKX Paper (Sandbox), we acts like Live (Deduct Idle). 
                    // Only strictly virtual paper needs Total deduction.
                    // Assuming we are mostly using OKX/Binance here:
                    deductionAmount = (mode === 'paper' && !exchangeData.exchange_name.includes('okx')) ? (alloc.total || 0) : (alloc.idle || 0);
                }

                let effectiveFree = exchangeFree - deductionAmount;

                // Fallback: If calculation says 0, but Exchange says we have Free funds,
                // and we suspect the remaining "Idle" is also stale/ghost:
                if (effectiveFree <= 0 && exchangeFree > 0) {
                    // Heuristic: If we are blocked but have money, let the user trade.
                    // The failure will happen at order placement if real collision occurs.
                    console.log(`[Portfolio] ${symbol} Overridden: Calc ${effectiveFree} -> Force ${exchangeFree}`);
                    effectiveFree = exchangeFree;
                }

                // Sanity Check: If Total - AllocTotal < Effective, clamp it?
                // RealAvailable <= (Total - AllocTotal) is also a valid check for overall consistency.
                const theoreticalMax = amount - totalReserved;
                // If desync, ignore theoreticalMax check
                if (!isDesync) {
                    // effectiveFree = Math.min(effectiveFree, theoreticalMax);
                }

                if (effectiveFree < 0) effectiveFree = 0;

                if (totalReserved > 0) {
                    console.log(`[Portfolio] ${symbol} Logic (${mode}): ExFree=${exchangeFree} - Deduct=${deductionAmount} = ${effectiveFree}. (TotalRes=${totalReserved}, Desync=${isDesync})`);
                }

                assetsList.push({
                    symbol,
                    balance: amount, // Total
                    free: effectiveFree, // Adjusted Available
                    reserved: totalReserved // sending for debug if needed
                });
            }
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
                free: asset.free, // Pass the effective free balance
                price,
                value: val,
                change: change24h ? parseFloat(change24h.toFixed(2)) : 0
            };
        });

        const changePercent = totalPreviousValue > 0 ? ((totalValue - totalPreviousValue) / totalPreviousValue) * 100 : 0;

        // 4. Get History (Real Only)
        let historyData = [];
        try {
            const tableName = mode === 'live' ? 'portfolio_snapshots_live' : 'portfolio_snapshots_paper';
            const historyQuery = await pool.query(
                `SELECT total_value FROM ${tableName} 
                 WHERE user_id = $1 
                 ORDER BY recorded_at DESC 
                 LIMIT 24`,
                [req.user.id]
            );
            if (historyQuery.rows.length > 0) {
                historyData = historyQuery.rows.map(r => parseFloat(r.total_value)).reverse();
            }
        } catch (e) { }

        if (totalValue > 0) historyData.push(totalValue);
        if (historyData.length < 2) historyData = [totalValue, totalValue];

        res.json({
            totalValue,
            changePercent: parseFloat(changePercent.toFixed(2)),
            assets: enrichedAssets.sort((a, b) => b.value - a.value),
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

const getMarketTickers = async (req, res) => {
    const { exchange: exchangeId, symbols } = req.query;
    if (!exchangeId || !symbols) return res.status(400).json({ message: 'Missing parameters' });
    try {
        const parsedExId = exchangeId.toLowerCase();
        if (!ccxt[parsedExId]) return res.status(400).json({ message: 'Exchange not supported' });

        const exchange = new ccxt[parsedExId]({ enableRateLimit: true });
        // Some exchanges require loadMarkets before fetchTickers
        await exchange.loadMarkets();

        const symbolArray = symbols.split(',').map(s => s.trim().toUpperCase());
        // Fetch tickers (ccxt usually supports passing list of symbols)
        const tickers = await exchange.fetchTickers(symbolArray);

        const result = [];
        symbolArray.forEach(sym => {
            const data = tickers[sym];
            if (data) {
                result.push({
                    symbol: sym,
                    lastPrice: data.last,
                    percentage: data.percentage // 24h change %
                });
            }
        });

        res.json(result);
    } catch (err) {
        console.error("Ticker fetch error:", err.message);
        res.status(500).json({ message: 'Failed to fetch tickers' });
    }
};

const getMarketCandles = async (req, res) => {
    const { exchange: exchangeId, symbol, timeframe = '1h' } = req.query;
    if (!exchangeId || !symbol) return res.status(400).json({ message: 'Missing parameters' });
    try {
        const parsedExId = exchangeId.toLowerCase();
        if (!ccxt[parsedExId]) return res.status(400).json({ message: 'Exchange not supported' });

        const exchange = new ccxt[parsedExId]({ enableRateLimit: true });

        // Ensure markets are loaded
        if (!exchange.markets) await exchange.loadMarkets();

        // Map UI timeframe to CCXT if needed, though 1h/4h/1d/1w is standard
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 50); // Get last 50 candles

        // Format for Recharts: { time: '12:00', price: 50000, high: ..., low: ... }
        const formattedData = candles.map(candle => {
            const [timestamp, open, high, low, close, volume] = candle;
            return {
                time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                dateFull: new Date(timestamp).toLocaleDateString(),
                price: close,
                // Add more if needed for sophisticated charts
            };
        });

        res.json(formattedData);
    } catch (err) {
        console.error("Candle fetch error:", err.message);
        res.status(500).json({ message: 'Failed to fetch candles' });
    }
};

const recordBotTrade = async (req, res) => {
    const { bot_id, side, price, amount, profit } = req.body;
    try {
        const botRes = await pool.query("SELECT config FROM bots WHERE bot_id = $1", [bot_id]);
        if (botRes.rows.length > 0) {
            let config = typeof botRes.rows[0].config === 'string' ? JSON.parse(botRes.rows[0].config) : botRes.rows[0].config;
            let currentProfit = parseFloat(config.total_profit || 0);

            if (profit !== undefined && profit !== null) {
                currentProfit += parseFloat(profit);
            }
            else if (side === 'sell') {
                const tradeValue = price * amount;
                currentProfit += tradeValue * 0.005; // Default estimation
            }
            config.total_profit = currentProfit.toFixed(4);
            config.trade_count = (config.trade_count || 0) + 1;
            await pool.query("UPDATE bots SET config = $1 WHERE bot_id = $2", [JSON.stringify(config), bot_id]);
            console.log(`? Trade Recorded: ${side} @ ${price}`);
        }
        res.json({ success: true });
    } catch (err) { console.error("Record Error:", err.message); res.status(500).json({ message: "Failed" }); }
};

const resumeActiveBots = async () => {
    console.log("?? System Startup: Checking for active bots to resume...");
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
                const isTestnet = mode === 'paper';
                const strategy = config.strategy || {};

                await axios.post(`${TRADING_ENGINE_URL}/start`, {
                    bot_id: bot.bot_id,
                    user_id: bot.user_id,
                    exchange: realExName,
                    pair: config.pair,
                    api_key: apiKey,
                    api_secret: apiSecret,
                    passphrase: passphrase,
                    mode: isTestnet ? 'paper' : 'live',
                    investment: parseFloat(strategy.investment || 0),
                    strategy: {
                        upper_price: parseFloat(strategy.upper_limit || strategy.upper_price || 0),
                        lower_price: parseFloat(strategy.lower_limit || strategy.lower_price || 0),
                        grids: parseInt(strategy.grid_count || strategy.grids || 10),
                        spacing: (strategy.grid_type || "ARITHMETIC").toLowerCase() === 'geometric' ? 'geometric' : 'arithmetic'
                    }
                });
                console.log(`? Resumed Bot ${bot.bot_id}`);
            } catch (e) { console.error(`? Resume Failed Bot ${bot.bot_id}`); }
        }
    } catch (err) { console.error("Auto-Resume Error:", err.message); }
};

const getAvailableBots = async (req, res) => { try { const r = await pool.query(`SELECT * FROM bots JOIN users ON bots.user_id = users.id WHERE users.role = 'admin'`); res.json(r.rows); } catch (e) { res.status(500).send('Error'); } };
const executeTradeSignal = async (req, res) => { res.status(200).json({ message: "Legacy endpoint" }); };

const runBacktest = async (req, res) => {
    try {
        console.log("?? Sending Backtest Request to Engine:", req.body);

        // 1. Call the Python Trading Engine
        // Ensure your Python engine has a POST /backtest route running on port 8000
        const engineResponse = await axios.post(`${TRADING_ENGINE_URL}/backtest`, req.body);

        // 2. Get Data from Engine
        const { chartData, stats, history } = engineResponse.data;

        // 3. Send Success Response to Frontend
        res.json({
            status: 'success',
            chartData: chartData || [],
            stats: stats || {},
            history: history || []
        });

        // 4. (Optional) Save Backtest to DB if needed
        // await pool.query('INSERT INTO backtests ...');

    } catch (err) {
        console.error("? Backtest Failed:", err.message);

        // Handle Engine Offline or Errors
        const errorMessage = err.response?.data?.message || "Trading Engine Offline or Error";
        res.json({
            status: 'error',
            message: errorMessage
        });
    }
};

const getBacktests = async (req, res) => { res.json([]); };
const saveBacktest = async (req, res) => { res.json({ message: "Saved" }); };

const getTopGainers = async (req, res) => {
    console.log("?? [TopGainers] Request received");
    try {
        // Use Binance as default for global top gainers
        const exchangeId = 'binance';
        if (!ccxt[exchangeId]) {
            console.log("?? [TopGainers] Binance not found in CCXT");
            return res.json([]);
        }

        console.log("?? [TopGainers] Initializing CCXT Binance...");
        const exchange = new ccxt[exchangeId]({ enableRateLimit: true });

        // Some exchanges require loadMarkets
        // await exchange.loadMarkets(); // Binance usually doesn't 'require' it for public fetchTickers, but good practice.

        console.log("?? [TopGainers] Fetching tickers...");
        // Fetch all tickers
        const tickers = await exchange.fetchTickers();
        console.log(`?? [TopGainers] Fetched ${Object.keys(tickers).length} tickers. Processing...`);

        // Filter valid USDT pairs and sort by percentage change
        const gainers = Object.values(tickers)
            .filter(t => t.symbol && t.symbol.endsWith('/USDT') && t.percentage !== undefined)
            .sort((a, b) => b.percentage - a.percentage) // Descending
            .slice(0, 5) // Top 5
            .map(t => ({
                pair: t.symbol,
                price: t.last,
                change: t.percentage
            }));

        console.log("?? [TopGainers] Sending response:", gainers);
        res.json(gainers);
    } catch (err) {
        console.error("?? [TopGainers] ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch top gainers" });
    }
};

module.exports = {
    getMe, updateProfile, addExchange, createBot, toggleBot, updateBot, deleteBot, getAvailableBots,
    authExchange, authExchangeCallback, getDashboard, getPortfolio,
    getUserBots, getMarketData, getMarketTickers, getMarketCandles, executeTradeSignal, recordBotTrade, runBacktest, getBacktests, saveBacktest, resumeActiveBots,
    getBacktests,
    saveBacktest,
    runBacktest,
    executeTradeSignal,
    recordBotTrade,
    getSupportedExchanges,
    recordBotTrade,
    getSupportedExchanges,
    getUserExchanges,
    deleteExchange,
    getTopGainers // <--- EXPORTED
};