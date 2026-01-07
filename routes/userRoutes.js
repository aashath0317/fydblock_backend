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
    toggleBot,          // <--- NEW: Pause/Resume Bot
    getAvailableBots,   // "Create New Bot" modal
    getUserExchanges,   // <--- NEW: Get all connected exchanges
    deleteExchange,     // <--- NEW: Delete exchange
    authExchange,
    authExchangeCallback,
    getDashboard,
    getPortfolio,
    getUserBots,
    getMarketData,
    getMarketTickers,
    getMarketCandles,
    getBacktests,
    saveBacktest,
    runBacktest,        // Sends request TO Python Engine
    executeTradeSignal, // Legacy signal handler
    recordBotTrade,      // <--- NEW: Receives trades FROM Python Engine
    getSupportedExchanges
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

// --- User Profile Routes ---
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

// --- Exchange Management ---
router.post('/exchange', protect, addExchange);
router.delete('/exchange/:name', protect, deleteExchange); // <--- NEW: Disconnect
router.get('/exchanges', protect, getUserExchanges); // <--- NEW Route
router.get('/exchange/supported', getSupportedExchanges);
router.get('/exchange/auth/:exchange', authExchange);
router.get('/exchange/callback/:exchange', authExchangeCallback);

// --- Bot Management ---
router.get('/bots', protect, getUserBots);              // Get User's Active Bots
router.get('/available-bots', protect, getAvailableBots); // Get System/Admin Bots
router.post('/bot', protect, createBot);                // Create New Bot
router.put('/bot/:id', protect, updateBot);             // Update/Configure Bot
router.put('/bot/:id/toggle', protect, toggleBot);      // <--- NEW: Toggle Route
router.delete('/bot/:id', protect, deleteBot);          // Delete Bot

// --- Dashboard & Portfolio ---
router.get('/dashboard', protect, getDashboard);
router.get('/portfolio', protect, getPortfolio);

// --- Terminal / Live Market Data (Public) ---
router.get('/market-data', getMarketData);
router.get('/market-tickers', getMarketTickers);
router.get('/market-candles', getMarketCandles);

// --- Backtesting Routes ---
router.get('/backtests', protect, getBacktests);
router.post('/backtest/save', protect, saveBacktest);
router.post('/backtest/run', protect, runBacktest); // Calls Python Backtester

// --- Python Engine Integration (Webhooks) ---
// These routes are NOT protected by 'protect' (JWT) because they are called by the Python script.
// Security is handled inside the controller using BOT_SECRET.

router.post('/bot-signal', executeTradeSignal); // Legacy/Signal Bot
router.post('/bot-trade', recordBotTrade);      // <--- NEW: Engine Sync Route

module.exports = router;