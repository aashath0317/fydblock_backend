// backend/routes/userRoutes.js
const router = require('express').Router();

// Import all controllers
const { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    updateBot,          // "Configure" button
    deleteBot,          // "Delete" button
    getAvailableBots,   // "Create New Bot" modal
    authExchange, 
    authExchangeCallback,
    getDashboard,
    getPortfolio,
    getUserBots,    
    getMarketData, 
    getBacktests,   
    saveBacktest,
    runBacktest,        // Sends request TO Python Engine
    executeTradeSignal  // Receives signal FROM Python Engine
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

// --- User Profile Routes ---
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

// --- Exchange Management ---
router.post('/exchange', protect, addExchange);
router.get('/exchange/auth/:exchange', authExchange); 
router.get('/exchange/callback/:exchange', authExchangeCallback);

// --- Bot Management ---
router.get('/bots', protect, getUserBots);              // Get User's Active Bots
router.get('/available-bots', protect, getAvailableBots); // Get System/Admin Bots
router.post('/bot', protect, createBot);                // Create New Bot
router.put('/bot/:id', protect, updateBot);             // Update/Configure Bot
router.delete('/bot/:id', protect, deleteBot);          // Delete Bot

// --- Dashboard & Portfolio ---
router.get('/dashboard', protect, getDashboard);
router.get('/portfolio', protect, getPortfolio); 

// --- Terminal / Live Market Data (Public) ---
router.get('/market-data', getMarketData);

// --- Backtesting Routes ---
router.get('/backtests', protect, getBacktests);
router.post('/backtest/save', protect, saveBacktest);
router.post('/backtest/run', protect, runBacktest); // Calls Python Backtester

// --- Python Engine Integration (Webhook) ---
// This route is NOT protected by 'protect' because it's called by the Python script, not a user browser.
// Security is handled inside the controller using BOT_SECRET.
router.post('/bot-signal', executeTradeSignal);

module.exports = router;
