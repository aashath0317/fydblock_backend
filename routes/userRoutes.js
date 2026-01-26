const router = require('express').Router();
const multer = require('multer');
const path = require('path');

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'user-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

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
    getSupportedExchanges,
    getTopGainers, // <--- Imported
    updateBotStatus, // <--- NEW: Status Sync
    getDailyStats,
    getMarketCoins,
    uploadAvatar, // <--- NEW
    getActiveSessions, // <--- NEW
    revokeSession // <--- NEW
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');
const { changePassword } = require('../controllers/authController');

// --- User Profile Routes ---
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/change-password', protect, changePassword);
router.post('/profile/avatar', protect, upload.single('avatar'), uploadAvatar);
router.get('/sessions', protect, getActiveSessions); // <--- NEW
router.delete('/sessions/:id', protect, revokeSession); // <--- NEW

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
router.get('/daily-stats', protect, getDailyStats); // Mobile specific route
router.get('/portfolio', protect, getPortfolio);

// --- Terminal / Live Market Data (Public) ---
router.get('/market-data', getMarketData);
router.get('/market-tickers', getMarketTickers);
router.get('/market-candles', getMarketCandles);
router.get('/market-coins', getMarketCoins); // <--- NEW Paginated Market Route
router.get('/market-top-gainers', getTopGainers); // <--- NEW Public Route

// --- Backtesting Routes ---
router.get('/backtests', protect, getBacktests);
router.post('/backtest/save', protect, saveBacktest);
router.post('/backtest/run', protect, runBacktest); // Calls Python Backtester

// --- Python Engine Integration (Webhooks) ---
// These routes are NOT protected by 'protect' (JWT) because they are called by the Python script.
// Security is handled inside the controller using BOT_SECRET.

router.post('/bot-signal', executeTradeSignal); // Legacy/Signal Bot
router.post('/bot-trade', recordBotTrade);      // <--- NEW: Engine Sync Route
router.post('/bot-status', updateBotStatus);    // <--- NEW: Status Sync Route

module.exports = router;