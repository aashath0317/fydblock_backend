// backend/routes/userRoutes.js
const router = require('express').Router();

// Import all controllers
const { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    authExchange, 
    authExchangeCallback,
    getDashboard,
    getPortfolio,
    getUserBots,    
    getMarketData, 
    getBacktests,   
    saveBacktest    
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

// --- User Profile Routes ---
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

// --- Exchange & Bot Management ---
router.post('/exchange', protect, addExchange);
router.post('/bot', protect, createBot);
router.get('/bots', protect, getUserBots);

// --- Dashboard & Portfolio ---
router.get('/dashboard', protect, getDashboard);
router.get('/portfolio', protect, getPortfolio); 

// --- Terminal / Live Market Data (Public) ---
router.get('/market-data', getMarketData);

// --- Backtesting Routes ---
router.get('/backtests', protect, getBacktests);
router.post('/backtest/save', protect, saveBacktest);

// --- Exchange OAuth Routes ---
router.get('/exchange/auth/:exchange', authExchange); 
router.get('/exchange/callback/:exchange', authExchangeCallback);
router.delete('/bot/:id', protect, deleteBot);

module.exports = router;
