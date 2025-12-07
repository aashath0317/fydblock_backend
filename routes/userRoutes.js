// routes/userRoutes.js
const router = require('express').Router();

// Import all controllers in one go
const { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    authExchange, 
    authExchangeCallback,
    getDashboard,
    getPortfolio 
    getUserBots
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

// User Profile Routes
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

// Exchange & Bot Routes
router.post('/exchange', protect, addExchange);
router.post('/bot', protect, createBot);

// Dashboard & Portfolio Routes
router.get('/dashboard', protect, getDashboard);
router.get('/portfolio', protect, getPortfolio); 

// --- OAUTH ROUTES ---
router.get('/exchange/auth/:exchange', authExchange); 
router.get('/exchange/callback/:exchange', authExchangeCallback);

router.get('/bots', protect, getUserBots);

module.exports = router;
