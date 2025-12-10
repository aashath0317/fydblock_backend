const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron'); // Import cron scheduler
const pool = require('./db'); // Database connection

// Load env vars
dotenv.config();

// Routes Imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes'); // If you have admin routes

const app = express();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 image uploads

// --- ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Health Check
app.get('/', (req, res) => {
    res.send('FydBlock API is running...');
});

// --- AUTOMATIC CLEANUP TASK (Cron Job) ---
// Runs every hour at minute 0 (e.g., 1:00, 2:00, 3:00)
cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] 🧹 Running hourly portfolio cleanup...`);
    try {
        // Delete records older than 24 hours
        const result = await pool.query(
            "DELETE FROM portfolio_snapshots WHERE recorded_at < NOW() - INTERVAL '24 hours'"
        );
        
        if (result.rowCount > 0) {
            console.log(`✅ Cleanup Success: Deleted ${result.rowCount} old records.`);
        } else {
            console.log(`ℹ️ Cleanup: No old records found.`);
        }
    } catch (err) {
        console.error('❌ Cleanup Error:', err.message);
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`⏰ Cron job scheduled: Deleting history older than 24h every hour.`);
});
