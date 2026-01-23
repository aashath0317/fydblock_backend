const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const pool = require('./db');
const ccxt = require('ccxt');
const { decrypt } = require('./utils/encryption');
const { getAuthenticatedExchange, clearAllCaches } = require('./utils/exchangeCache');

// Load env vars
// Load env vars
dotenv.config();

// --- CUSTOM LOGGING START ---
const fs = require('fs');
const path = require('path');
const util = require('util');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = fs.createWriteStream(path.join(logDir, 'system.log'), { flags: 'a' });
const logStdout = process.stdout;
const logStderr = process.stderr;

console.log = function () {
    const timestamp = new Date().toISOString();
    logFile.write(`[${timestamp}] [INFO] ` + util.format.apply(null, arguments) + '\n');
    logStdout.write(`[${timestamp}] [INFO] ` + util.format.apply(null, arguments) + '\n');
};

console.error = function () {
    const timestamp = new Date().toISOString();
    logFile.write(`[${timestamp}] [ERROR] ` + util.format.apply(null, arguments) + '\n');
    logStderr.write(`[${timestamp}] [ERROR] ` + util.format.apply(null, arguments) + '\n');
};
// --- CUSTOM LOGGING END ---

// Routes Imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const blogRoutes = require('./routes/blogRoutes');
const partnerRoutes = require('./routes/partnerRoutes');
const sendEmail = require('./utils/sendEmail');
const {
    getWelcomeEmailHtml,
    getNewLoginEmailHtml,
    getApiConnectionLostEmailHtml,
    getTargetReachedEmailHtml,
    getPaymentConfirmedEmailHtml,
    getPaymentFailedEmailHtml
} = require('./utils/emailTemplates');

const app = express();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/partner', partnerRoutes);

// --- TEST EMAIL ROUTES (DEV ONLY) ---
app.post('/api/test-email', async (req, res) => {
    const { type, email } = req.body;
    let html = '';
    let subject = 'Fydblock Test Email';

    try {
        switch (type) {
            case 'welcome':
                html = getWelcomeEmailHtml('Admin');
                subject = 'Welcome to Fydblock';
                break;
            case 'login':
                html = getNewLoginEmailHtml('Admin', 'Chrome on Windows', 'New York, USA', 'Jan 09, 2026 - 05:30 PM', '192.168.1.1');
                subject = 'New Login Detected';
                break;
            case 'api_lost':
                html = getApiConnectionLostEmailHtml('Admin', 'Binance');
                subject = 'API Connection Lost';
                break;
            case 'target':
                html = getTargetReachedEmailHtml('Admin', 'BTC-Scalper-01', '4.5', 'BTC/USDT');
                subject = 'Target Reached';
                break;
            case 'payment_confirmed':
                html = getPaymentConfirmedEmailHtml('Admin', 'Pro Trader Monthly', 'Jan 09, 2026', '$290.00 USD');
                subject = 'Payment Confirmed';
                break;
            case 'payment_failed':
                html = getPaymentFailedEmailHtml('Admin');
                subject = 'Payment Failed';
                break;
            default:
                return res.status(400).send('Invalid type');
        }

        await sendEmail({ email, subject, message: html });
        res.json({ message: `Sent ${type} email to ${email}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Health Check
app.get('/', (req, res) => {
    res.send('FydBlock API is running...');
});

// --- AUTOMATIC SNAPSHOT TASK (Cron Job) ---
// Runs every 30 minutes
// --- AUTOMATIC SNAPSHOT TASK (Cron Job) ---
// Runs every 30 minutes
// --- AUTOMATIC SNAPSHOT TASK (Cron Job) ---
// Runs every hour
cron.schedule('0 * * * *', async () => {
    const memory = process.memoryUsage();
    console.log(`[${new Date().toISOString()}] 📸 Memory Usage - RSS: ${(memory.rss / 1024 / 1024).toFixed(2)}MB, Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[${new Date().toISOString()}] 📸 Taking portfolio & profit snapshots...`);

    try {
        // 1. Get all users who have connected exchanges
        const usersWithKeys = await pool.query(
            `SELECT DISTINCT ON (user_id, exchange_name) 
                user_id, exchange_name, api_key, api_secret, passphrase 
             FROM user_exchanges 
             WHERE connection_type = 'manual' 
             ORDER BY user_id, exchange_name, created_at DESC`
        );

        for (const record of usersWithKeys.rows) {
            try {
                // Determine mode
                const mode = record.exchange_name.includes('_paper') ? 'paper' : 'live';

                // --- A. SAVE BOT PROFIT SNAPSHOTS ---
                const botsQuery = await pool.query(
                    `SELECT bot_id, config FROM bots WHERE user_id = $1 AND bot_type != 'SKIPPED'`,
                    [record.user_id]
                );

                // Save Per-Bot Profit
                for (const b of botsQuery.rows) {
                    const cfg = typeof b.config === 'string' ? JSON.parse(b.config || '{}') : b.config;
                    if ((cfg.mode || 'live') === mode) {
                        const profit = parseFloat(cfg.total_profit || 0);
                        // Save to bot_snapshots table
                        await pool.query(
                            `INSERT INTO bot_snapshots (bot_id, total_profit, recorded_at) VALUES ($1, $2, NOW())`,
                            [b.bot_id, profit]
                        );
                    }
                }

                // --- B. SAVE PORTFOLIO EQUITY SNAPSHOTS (CCXT) ---
                const apiKey = decrypt(record.api_key);
                const apiSecret = decrypt(record.api_secret);
                const passphrase = record.passphrase ? decrypt(record.passphrase) : undefined;
                const exchangeId = record.exchange_name.replace('_paper', '').toLowerCase();

                let totalEquity = 0;

                if (ccxt[exchangeId]) {
                    // Use cached exchange instance
                    const exchange = getAuthenticatedExchange({
                        exchangeId,
                        userId: record.user_id,
                        apiKey,
                        apiSecret,
                        password: passphrase,
                        sandbox: record.exchange_name.includes('_paper')
                    });

                    const balance = await exchange.fetchBalance();
                    if (balance.total) {
                        const assets = Object.keys(balance.total).filter(sym => balance.total[sym] > 0);
                        if (assets.length > 0) {
                            const symbolsToFetch = assets
                                .filter(sym => sym !== 'USDT' && sym !== 'USDC')
                                .map(sym => `${sym}/USDT`);

                            let tickers = {};
                            if (symbolsToFetch.length > 0) {
                                try { tickers = await exchange.fetchTickers(symbolsToFetch); } catch (e) { }
                            }

                            assets.forEach(sym => {
                                const qty = balance.total[sym];
                                if (sym === 'USDT' || sym === 'USDC' || sym === 'DAI') totalEquity += qty;
                                else if (tickers[`${sym}/USDT`]) totalEquity += qty * tickers[`${sym}/USDT`].last;
                            });
                        }
                    }
                }

                if (totalEquity > 0) {
                    const tableName = mode === 'live' ? 'portfolio_snapshots_live' : 'portfolio_snapshots_paper';
                    await pool.query(
                        `INSERT INTO ${tableName} (user_id, total_value, recorded_at) VALUES ($1, $2, NOW())`,
                        [record.user_id, totalEquity]
                    );

                    console.log(`✅ [${mode.toUpperCase()}] Snapshot saved for User ${record.user_id}. Equity: $${totalEquity.toFixed(2)}`);
                }

            } catch (userErr) {
                console.error(`❌ Failed snapshot for User ${record.user_id}: ${userErr.message}`);
            }
        }
    } catch (err) {
        console.error('❌ Snapshot Cron Error:', err.message);
    }
});

// Cleanup Task Removed (Data retained for historical analysis)

// --- START SERVER ---
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`⏰ Cron jobs scheduled.`);
});

// --- GRACEFUL SHUTDOWN ---
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Clear exchange caches to free memory
    clearAllCaches();

    // Close log file
    if (logFile) logFile.end();

    // Close the server
    server.close(() => {
        console.log('HTTP server closed.');

        // Close database pool
        pool.end(() => {
            console.log('Database pool closed.');
            process.exit(0);
        });
    });

    // Force close after 10 seconds
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));