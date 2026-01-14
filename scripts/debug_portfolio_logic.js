const { Pool } = require('pg');
const ccxt = require('ccxt');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
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

async function run() {
    try {
        console.log("--- DEBUG PORTFOLIO LOGIC ---");
        const targetEmail = 'info9@email.com';
        const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [targetEmail]);
        if (userRes.rows.length === 0) { console.log("User not found"); return; }
        const userId = userRes.rows[0].id;

        const mode = 'paper';
        console.log(`User ID: ${userId}, Mode: ${mode}`);

        // 1. Get Keys
        let query = 'SELECT * FROM user_exchanges WHERE user_id = $1 ';
        query += mode === 'paper' ? "AND exchange_name LIKE '%_paper' " : "AND exchange_name NOT LIKE '%_paper' ";
        query += 'ORDER BY created_at DESC LIMIT 1';
        const keysQuery = await pool.query(query, [userId]);

        if (keysQuery.rows.length === 0) { console.log("No keys found"); return; }
        const exchangeData = keysQuery.rows[0];

        console.log(`Exchange: ${exchangeData.exchange_name}`);

        const apiKey = decrypt(exchangeData.api_key);
        const apiSecret = decrypt(exchangeData.api_secret);
        const password = exchangeData.passphrase ? decrypt(exchangeData.passphrase) : undefined;

        const exchangeId = exchangeData.exchange_name.replace('_paper', '').toLowerCase();
        const exchange = new ccxt[exchangeId]({ apiKey, secret: apiSecret, password, enableRateLimit: true });
        if (mode === 'paper' && exchange.has['sandbox']) exchange.setSandboxMode(true);

        // 2. Fetch Balance
        console.log("Fetching Exchange Balance...");
        const balanceData = await exchange.fetchBalance();
        const total = balanceData.total;

        // 3. Fetch Allocations
        console.log("Fetching Engine Allocations...");
        let reservedBalances = {};
        try {
            const engineUrl = process.env.TRADING_ENGINE_URL || "http://127.0.0.1:8000";
            const allocRes = await axios.get(`${engineUrl}/allocations`, { params: { mode } });
            reservedBalances = allocRes.data || {};
            console.log("Allocations:", JSON.stringify(reservedBalances, null, 2));
        } catch (e) {
            console.log("Engine Allocation Error (Expected if engine off/local):", e.message);
        }

        // 4. Calculate Logic
        console.log("\n--- CALCULATION DETAILS ---");
        const balances = balanceData.total || {};
        const freeBalances = balanceData.free || {};

        Object.entries(balances).forEach(([symbol, amount]) => {
            if (amount > 0 && symbol === 'USDT') {
                // Logic from userController.js
                let exchangeFree = amount; // Start with Total

                // Try extract exact free
                // LOGIC MATCHING userController.js
                if (balanceData[symbol]) {
                    if (balanceData[symbol].free !== undefined) {
                        exchangeFree = balanceData[symbol].free;
                        console.log(`  [EXTRACT] Found balanceData[${symbol}].free: ${exchangeFree}`);
                    } else if (balanceData[symbol].used !== undefined) {
                        exchangeFree = amount - balanceData[symbol].used;
                        console.log(`  [EXTRACT] Found balanceData[${symbol}].used, calc free: ${exchangeFree}`);
                    }
                } else if (freeBalances[symbol] !== undefined) {
                    exchangeFree = freeBalances[symbol];
                    console.log(`  [EXTRACT] Found freeBalances[${symbol}]: ${exchangeFree}`);
                } else {
                    console.log(`  [EXTRACT] NO FREE FIELD FOUND. Defaulting to Total: ${exchangeFree}`);
                }

                const alloc = reservedBalances[symbol] || { total: 0, idle: 0 };
                const totalReserved = alloc.total || 0;

                // DETECT GHOST ALLOCATIONS / DESYNC
                const isDesync = totalReserved > amount * 1.5;

                let deductionAmount = 0;

                if (isDesync) {
                    console.warn(`  [LOGIC] Desync detected! TotalReserved(${totalReserved}) > Amount*1.5. Ignoring allocation.`);
                    deductionAmount = 0;
                } else {
                    deductionAmount = (mode === 'paper' && !exchangeData.exchange_name.includes('okx')) ? (alloc.total || 0) : (alloc.idle || 0);
                    console.warn(`  [LOGIC] Normal Deduction: ${deductionAmount}`);
                }

                let effectiveFree = exchangeFree - deductionAmount;
                console.log(`  [LOGIC] effectiveFree (${effectiveFree}) = exchangeFree (${exchangeFree}) - deduction (${deductionAmount})`);

                // Fallback check
                if (effectiveFree <= 0 && exchangeFree > 0) {
                    console.log(`  [FALLBACK] effectiveFree <= 0 but exchangeFree > 0. OVERRIDING.`);
                    effectiveFree = exchangeFree;
                }

                const theoreticalMax = amount - totalReserved;
                // If desync, ignore theoreticalMax check
                if (!isDesync) {
                    // effectiveFree = Math.min(effectiveFree, theoreticalMax);
                }
                const finalFree = effectiveFree < 0 ? 0 : effectiveFree;

                console.log(`\n  FINAL SUMMARY for ${symbol}:`);
                console.log(`  Total:     ${amount}`);
                console.log(`  ExchFree:  ${exchangeFree}`);
                console.log(`  Effective: ${finalFree}`);
            }
        });

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
