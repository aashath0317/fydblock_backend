const path = require('path');
const dotenvPath = path.join(__dirname, '../.env');
console.log("Loading .env from:", dotenvPath);
require('dotenv').config({ path: dotenvPath });

// Override HOST to IPv4
process.env.DB_HOST = '127.0.0.1';

console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD Length:", process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 0);

const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error("DB Error:", err.message);
    } else {
        console.log("DB Connected. Time:", res.rows[0].now);
    }
    pool.end();
});
