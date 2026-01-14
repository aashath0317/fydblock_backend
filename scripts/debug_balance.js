const { Pool } = require('pg');
const ccxt = require('ccxt');
const crypto = require('crypto');
const path = require('path');
// Load .env from backend root (one level up from scripts)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function decrypt(text) {
    if (!text) return null;
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

async function debugBalance() {
    try {
        console.log("--- DEBUGGING BALANCE (LIVE & PAPER) ---");

        // 1. Get the user
        const targetEmail = 'info9@email.com';
        const userRes = await pool.query("SELECT id, email FROM users WHERE email = $1", [targetEmail]);
        if (userRes.rows.length === 0) {
            console.log(`User ${targetEmail} not found. Checking all users...`);
            // Fallback just in case
            const allUsers = await pool.query("SELECT email FROM users");
            console.log("Available Emails:", allUsers.rows.map(u => u.email).join(", "));
            return;
        }
        const userId = userRes.rows[0].id;
        console.log(`User: ${userRes.rows[0].email} (ID: ${userId})`);

        // 2. Get ANY Exchange Keys (Live or Paper)
        const keysQuery = await pool.query(
            "SELECT * FROM user_exchanges WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );

        if (keysQuery.rows.length === 0) {
            console.log("No Exchanges found in DB for this user.");
            return;
        }

        console.log(`Found ${keysQuery.rows.length} connected exchange(s).`);

        // Iterate through all connected exchanges
        for (const exchangeData of keysQuery.rows) {
            const isPaper = exchangeData.exchange_name.includes('_paper');
            const realName = exchangeData.exchange_name.replace('_paper', '').toLowerCase();
            const modeLabel = isPaper ? "PAPER" : "LIVE";

            console.log(`\nChecking [${modeLabel}] ${realName}...`);

            const apiKey = decrypt(exchangeData.api_key);
            const apiSecret = decrypt(exchangeData.api_secret);
            const passphrase = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

            if (!apiKey || !apiSecret) {
                console.log("  Failed to decrypt keys. Skipping.");
                continue;
            }

            // 3. Connect to Exchange
            const exchange = new ccxt[realName]({
                apiKey,
                secret: apiSecret,
                password: passphrase,
                enableRateLimit: true
            });

            if (isPaper || (realName === 'okx' && isPaper)) {
                if (exchange.has['sandbox']) exchange.setSandboxMode(true);
            }

            // 4. Fetch Balance
            try {
                const balanceData = await exchange.fetchBalance();
                const total = balanceData.total;

                let estimatedTotalValue = 0;

                // Filter > 0
                const symbols = Object.keys(total).filter(curr => total[curr] > 0);

                if (symbols.length === 0) {
                    console.log("  No assets found > 0.");
                    continue;
                }

                console.log("  Assets:");
                for (const curr of symbols) {
                    const amount = total[curr];
                    const free = balanceData.free[curr] || 0;
                    const used = balanceData.used[curr] || 0;

                    let price = 0;

                    if (['USDT', 'USDC', 'DAI', 'FDUSD'].includes(curr)) {
                        price = 1;
                    } else {
                        try {
                            const ticker = await exchange.fetchTicker(`${curr}/USDT`);
                            price = ticker.last;
                        } catch (e) {
                            // Try one more time with a common base if failed?
                            // console.log(`    (No price for ${curr})`);
                        }
                    }

                    const value = amount * price;
                    estimatedTotalValue += value;

                    console.log(`    - ${curr}: Total=${amount.toFixed(6)} | Free=${free.toFixed(6)} | Used=${used.toFixed(6)} (~$${value.toFixed(2)})`);
                }

                console.log(`  => TOTAL EQUITY: $${estimatedTotalValue.toFixed(2)}`);

            } catch (err) {
                console.log(`  Error fetching balance: ${err.message}`);
            }
        }

    } catch (e) {
        console.error("Script Error:", e);
    } finally {
        await pool.end();
        process.exit();
    }
}

debugBalance();
