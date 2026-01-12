const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const pool = require('./db');
const ccxt = require('ccxt');
const { decrypt } = require('./utils/encryption');

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
cron.schedule('*/30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] ?? Taking portfolio snapshots...`);

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
                // 2. Decrypt Keys
                const apiKey = decrypt(record.api_key);
                const apiSecret = decrypt(record.api_secret);
                const passphrase = record.passphrase ? decrypt(record.passphrase) : undefined;

                // 3. Connect to Exchange
                const exchangeId = record.exchange_name.replace('_paper', '').toLowerCase();
                if (!ccxt[exchangeId]) continue;

                const exchange = new ccxt[exchangeId]({
                    apiKey,
                    secret: apiSecret,
                    password: passphrase,
                    enableRateLimit: true
                });

                // Handle Paper Trading / Sandbox
                if (record.exchange_name.includes('_paper')) {
                    if (exchange.has['sandbox']) exchange.setSandboxMode(true);
                }

                // 4. Fetch Total Balance (Equity)
                // Determine mode based on exchange name tag
                const mode = record.exchange_name.includes('_paper') ? 'paper' : 'live';

                const balance = await exchange.fetchBalance();
                let totalEquity = 0;

                if (balance.total) {
                    // 1. Identify assets with a balance > 0
                    const assets = Object.keys(balance.total).filter(sym => balance.total[sym] > 0);

                    if (assets.length > 0) {
                        // 2. Fetch current prices for all these assets (against USDT)
                        // Filter out 'USDT' itself from the ticker fetch list to avoid errors
                        const symbolsToFetch = assets
                            .filter(sym => sym !== 'USDT' && sym !== 'USDC')
                            .map(sym => `${sym}/USDT`);

                        let tickers = {};
                        if (symbolsToFetch.length > 0) {
                            try {
                                tickers = await exchange.fetchTickers(symbolsToFetch);
                            } catch (e) {
                                console.error("Error fetching tickers:", e.message);
                            }
                        }

                        // 3. Calculate Total Value
                        assets.forEach(sym => {
                            const qty = balance.total[sym];

                            if (sym === 'USDT' || sym === 'USDC' || sym === 'DAI') {
                                // Stablecoins count as $1 (approx)
                                totalEquity += qty;
                            } else if (tickers[`${sym}/USDT`]) {
                                // Crypto assets: Quantity * Current Price
                                totalEquity += qty * tickers[`${sym}/USDT`].last;
                            }
                        });
                    }
                }

                // 4. Save to Database (Split Tables)
                if (totalEquity > 0) {
                    const tableName = mode === 'live' ? 'portfolio_snapshots_live' : 'portfolio_snapshots_paper';
                    await pool.query(
                        `INSERT INTO ${tableName} (user_id, total_value, recorded_at) 
                         VALUES ($1, $2, NOW())`,
                        [record.user_id, totalEquity]
                    );
                    console.log(`? [${mode.toUpperCase()}] Snapshot saved to ${tableName}: $${totalEquity.toFixed(2)}`);
                }

            } catch (userErr) {
                console.error(`? Failed snapshot for User ${record.user_id}: ${userErr.message}`);
            }
        }
    } catch (err) {
        console.error('? Snapshot Cron Error:', err.message);
    }
});

// --- HOURLY CLEANUP TASK ---
// Deletes history older than 24h to keep DB light
cron.schedule('0 * * * *', async () => {
    try {
        await pool.query("DELETE FROM portfolio_snapshots_live WHERE recorded_at < NOW() - INTERVAL '24 hours'");
        await pool.query("DELETE FROM portfolio_snapshots_paper WHERE recorded_at < NOW() - INTERVAL '24 hours'");
        console.log('?? Cleanup: Old snapshots removed from both tables.');
    } catch (err) {
        console.error('Cleanup Error:', err);
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`?? Server running on port ${PORT}`);
    console.log(`?? Cron jobs scheduled.`);
});