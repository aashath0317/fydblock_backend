const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');
const pool = require('./db');
const userRoutes = require('./routes/userRoutes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Allows your React app to talk to this backend
app.use(express.json()); // Allows backend to understand JSON data

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// Simple test route
app.get('/', (req, res) => {
    res.send('FydBlock API is running...');
});

app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            message: 'Database Connection Successful!',
            time: result.rows[0].now
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: 'Database Connection Failed',
            error: err.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
