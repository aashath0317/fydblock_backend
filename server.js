const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Allows your React app to talk to this backend
app.use(express.json()); // Allows backend to understand JSON data

// Routes
app.use('/api/auth', authRoutes);

// Simple test route
app.get('/', (req, res) => {
    res.send('FydBlock API is running...');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});