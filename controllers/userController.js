// backend/controllers/userController.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const ccxt = require('ccxt');
const { encrypt, decrypt } = require('../utils/encryption');

// --- GLOBAL CACHE (For Prices) ---
let priceCache = { data: {}, lastFetch: 0 };

// --- HELPER: FETCH PRICES WITH CACHING ---
const fetchTokenPrices = async (symbols) => {
    if (symbols.length === 0) return {};
    
    // 1. Check Cache (1 minute duration)
    const CACHE_DURATION = 60 * 1000;
    const now = Date.now();

    if (now - priceCache.lastFetch < CACHE_DURATION && Object.keys(priceCache.data).length > 0) {
        return priceCache.data;
    }

    // 2. Comprehensive Map for CoinGecko IDs
    const symbolMap = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin',
        'USDC': 'usd-coin', 'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
        'AVAX': 'avalanche-2', 'TRX': 'tron', 'SHIB': 'shiba-inu', 'LINK': 'chainlink',
        'ATOM': 'cosmos', 'UNI': 'uniswap', 'NEAR': 'near', 'ALGO': 'algorand'
    };

    const assetIds = symbols.map(s => symbolMap[s] || s.toLowerCase()).join(',');

    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetIds}&vs_currencies=usd&include_24hr_change=true`;
        const res = await axios.get(url);
        
        // Update Cache
        priceCache.data = res.data;
        priceCache.lastFetch = now;
        
        return res.data;
    } catch (err) {
        console.error("CoinGecko Error:", err.message);
        return priceCache.data || {}; // Return stale cache if API fails
    }
};

// @desc    Get Public Market Data (Order Book)
const getMarketData = async (req, res) => {
    const { exchange: exchangeId, symbol } = req.query;

    if (!exchangeId || !symbol) {
        return res.status(400).json({ message: 'Missing exchange or symbol' });
    }

    try {
        // 1. Check if exchange exists in CCXT
        if (!ccxt[exchangeId.toLowerCase()]) {
            return res.status(400).json({ message: 'Exchange not supported' });
        }

        // 2. Instantiate Exchange (Public - no keys needed for Order Book)
        const exchange = new ccxt[exchangeId.toLowerCase()]();
        
        // 3. Format Symbol: CCXT expects "BTC/USDT", Frontend sends "BTCUSDT"
        // Simple logic to insert slash if missing (Assuming USDT pairs for now)
        let formattedSymbol = symbol;
        if (!symbol.includes('/')) {
            // Try to split basic pairs. In production, use a more robust mapper.
            if (symbol.endsWith('USDT')) formattedSymbol = symbol.replace('USDT', '/USDT');
            else if (symbol.endsWith('USD')) formattedSymbol = symbol.replace('USD', '/USD');
            else if (symbol.endsWith('BTC')) formattedSymbol = symbol.replace('BTC', '/BTC');
        }

        // 4. Fetch Order Book
        const orderBook = await exchange.fetchOrderBook(formattedSymbol, 10); // Limit to top 10 bids/asks

        res.json({
            symbol: formattedSymbol,
            bids: orderBook.bids,
            asks: orderBook.asks,
            timestamp: Date.now()
        });

    } catch (err) {
        console.error(`Market Data Error (${exchangeId}):`, err.message);
        res.status(500).json({ message: 'Failed to fetch market data' });
    }
};

// --- HELPER: CALCULATE TOTAL VALUE (Used by Cron & API) ---
const calculateUserTotalValue = async (userId) => {
    // 1. Get User Keys
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
        // 2. Fetch Balance
        const tradingBalance = await exchange.fetchBalance();
        let balances = {};
        
        if (tradingBalance.total) {
            for (const [symbol, amount] of Object.entries(tradingBalance.total)) {
                if (amount > 0) balances[symbol] = amount;
            }
        }

        // OKX Funding Logic
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

        // 3. Get Prices & Sum
        const symbols = assetsList.map(a => a.symbol);
        const prices = await fetchTokenPrices(symbols);
        let totalValue = 0;

        // Re-declare map here for local usage (or move it to global scope)
        const symbolMap = { 
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana', 
            'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin',
            'USDC': 'usd-coin', 'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
            'AVAX': 'avalanche-2', 'TRX': 'tron', 'SHIB': 'shiba-inu', 'LINK': 'chainlink'
        };

        assetsList.forEach(asset => {
            const coinId = symbolMap[asset.symbol] || asset.symbol.toLowerCase();
            const priceData = prices[coinId] || { usd: 0 };
            totalValue += asset.balance * priceData.usd;
        });

        return totalValue;

    } catch (err) {
        // IMPROVED ERROR HANDLING
        if (err instanceof ccxt.AuthenticationError) {
            console.error(`Calc Error User ${userId}: Invalid API Keys`);
        } else if (err instanceof ccxt.NetworkError) {
            console.error(`Calc Error User ${userId}: Network Issue`);
        } else {
            console.error(`Calc Error User ${userId}:`, err.message);
        }
        return 0;
    }
};

// --- CONTROLLERS ---

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
        const botQuery = await pool.query('SELECT * FROM bots WHERE user_id = $1', [req.user.id]);
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

// @desc    Add Exchange Key (Manual Connection)
const addExchange = async (req, res) => {
    const { exchange_name, api_key, api_secret, passphrase } = req.body;

    try {
        // Validate keys before saving (Optional but recommended)
        const exchangeId = exchange_name.toLowerCase();
        if (ccxt[exchangeId]) {
            const exchange = new ccxt[exchangeId]({
                apiKey: api_key,
                secret: api_secret,
                password: passphrase
            });
            // Try a lightweight public call or balance check to verify
            // await exchange.fetchBalance(); 
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
        // Handle specific CCXT errors during connection test here if you implemented the check above
        res.status(500).send('Server Error');
    }
};

// @desc    Redirect user to Exchange OAuth Page
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
    } else if (exchange === 'okx') {
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
const authExchangeCallback = async (req, res) => {
    const { exchange } = req.params;
    const { code, state } = req.query;

    if (!code || !state) return res.status(400).send("Invalid callback data");

    try {
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
const createBot = async (req, res) => {
    const { bot_name, quote_currency, bot_type, plan, billing_cycle } = req.body;

    try {
        await pool.query(
            'INSERT INTO subscriptions (user_id, plan_type, billing_cycle) VALUES ($1, $2, $3) RETURNING subscription_id',
            [req.user.id, plan, billing_cycle]
        );

        const exchange = await pool.query(
            'SELECT exchange_id FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        
        const exchangeId = exchange.rows.length > 0 ? exchange.rows[0].exchange_id : null;

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
const getDashboard = async (req, res) => {
    try {
        const botsQuery = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // In a real app, you would calculate these from live trading data or DB history
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

// @desc    Get Real-Time Portfolio + History
const getPortfolio = async (req, res) => {
    try {
        // 1. Get Real-Time Assets
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
        
        // --- IMPROVED ERROR HANDLING FOR PORTFOLIO ---
        try {
            const trading = await exchange.fetchBalance();
            if (trading.total) Object.entries(trading.total).forEach(([s, a]) => { if (a > 0) balances[s] = a; });
            
            if (exchangeId === 'okx') {
                const funding = await exchange.fetchBalance({ type: 'funding' });
                if (funding.total) Object.entries(funding.total).forEach(([s, a]) => { balances[s] = (balances[s] || 0) + a; });
            }
        } catch (e) {
            console.error("Portfolio Fetch Error:", e.message);
            if (e instanceof ccxt.AuthenticationError) {
                return res.status(401).json({ message: 'Invalid API Keys. Please check your exchange connection.' });
            } else if (e instanceof ccxt.NetworkError) {
                return res.status(503).json({ message: 'Exchange is currently unreachable. Please try again later.' });
            } else if (e instanceof ccxt.RateLimitExceeded) {
                 return res.status(429).json({ message: 'Rate limit exceeded. Please try again later.' });
            }
            // For other exchange errors, return a generic 500 but log the specific error
            return res.status(500).json({ message: 'Error fetching portfolio data from exchange.' });
        }

        const assetsList = Object.entries(balances).map(([s, b]) => ({ symbol: s, balance: b }));
        const prices = await fetchTokenPrices(assetsList.map(a => a.symbol));

        let totalValue = 0;
        let previousTotalValue = 0;
        
        // Full Symbol Map for Portfolio
        const symbolMap = { 
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana', 
            'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin',
            'USDC': 'usd-coin', 'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
            'AVAX': 'avalanche-2', 'TRX': 'tron', 'SHIB': 'shiba-inu', 'LINK': 'chainlink',
            'ATOM': 'cosmos', 'UNI': 'uniswap'
        };

        const enrichedAssets = assetsList.map(asset => {
            const coinId = symbolMap[asset.symbol] || asset.symbol.toLowerCase();
            const priceData = prices[coinId] || { usd: 0, usd_24h_change: 0 };
            
            const currentPrice = priceData.usd;
            const change24h = priceData.usd_24h_change || 0;
            const val = asset.balance * currentPrice;
            
            totalValue += val;
            
            if (change24h !== 0) {
                const prevPrice = currentPrice / (1 + (change24h / 100));
                previousTotalValue += asset.balance * prevPrice;
            } else {
                previousTotalValue += val;
            }

            return {
                id: asset.symbol, symbol: asset.symbol, name: asset.symbol,
                balance: asset.balance, price: currentPrice, value: val,
                change: change24h,
                icon: `https://cryptologos.cc/logos/${coinId}-${asset.symbol.toLowerCase()}-logo.png`
            };
        }).filter(a => a.value > 1).sort((a, b) => b.value - a.value);

        const changePercent = previousTotalValue > 0 ? ((totalValue - previousTotalValue) / previousTotalValue) * 100 : 0;

        // 2. FETCH HISTORY FROM DATABASE (The 24h Chart)
        const historyQuery = await pool.query(
            `SELECT total_value FROM portfolio_snapshots 
             WHERE user_id = $1 AND recorded_at >= NOW() - INTERVAL '24 HOURS' 
             ORDER BY recorded_at ASC`,
            [req.user.id]
        );

        let history = historyQuery.rows.map(r => parseFloat(r.total_value));

        // If no history exists yet (new user), use current value as a starting point
        if (history.length === 0) {
            history = [totalValue]; 
        } else {
            // Append current real-time value to the end of the chart for the "live" feel
            history.push(totalValue);
        }

        res.json({
            totalValue,
            changePercent,
            assets: enrichedAssets,
            history: history // Chart data
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc    Get All User Bots with Performance Data (Mocked for UI)
const getUserBots = async (req, res) => {
    try {
        // Fetch real bots from DB
        const botsQuery = await pool.query(
            'SELECT * FROM bots WHERE user_id = $1 AND status != \'archived\' ORDER BY created_at DESC',
            [req.user.id]
        );

        // Enhance with mock performance data (since we don't have a live trading engine yet)
        const enrichedBots = botsQuery.rows.map(bot => {
            // Generate random profit/loss for demo visualization
            const isPositive = Math.random() > 0.3;
            const totalProfit = (Math.random() * 5000).toFixed(2);
            const invested = (Math.random() * 5000 + 1000).toFixed(2);

            // Mock chart data (array of numbers)
            const chartData = Array.from({ length: 10 }, () => Math.floor(Math.random() * 100));

            return {
                ...bot,
                total_profit: isPositive ? totalProfit : -totalProfit,
                invested_capital: invested,
                chart_data: chartData,
                is_running: bot.status === 'running' || bot.status === 'ready'
            };
        });

        res.json(enrichedBots);
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
    getDashboard, 
    getPortfolio, 
    calculateUserTotalValue,
    getUserBots, // Added comma here
    getMarketData
};
