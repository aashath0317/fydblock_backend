const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron'); // Import Cron
const authRoutes = require('./routes/authRoutes');
const pool = require('./db');
const userRoutes = require('./routes/userRoutes');
const { calculateUserTotalValue } = require('./controllers/userController'); // Import helper
const adminRoutes = require('./routes/adminRoutes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => res.send('FydBlock API is running...'));

// --- CRON JOB: Runs Every Hour at Minute 0 ---
cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running Portfolio Snapshot...`);
    
    try {
        // 1. Get all users who have connected an exchange
        const users = await pool.query('SELECT DISTINCT user_id FROM user_exchanges');
        
        for (const user of users.rows) {
            // 2. Calculate Value
            const totalValue = await calculateUserTotalValue(user.user_id);
            
            // 3. Save to DB
            if (totalValue > 0) {
                await pool.query(
                    'INSERT INTO portfolio_snapshots (user_id, total_value) VALUES ($1, $2)',
                    [user.user_id, totalValue]
                );
                console.log(`Saved snapshot for User ${user.user_id}: $${totalValue}`);
            }
        }
    } catch (err) {
        console.error('Snapshot Job Error:', err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

