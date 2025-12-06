const router = require('express').Router();
const { getMe, updateProfile, addExchange, createBot, authExchange, authExchangeCallback } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/exchange', protect, addExchange);
router.post('/bot', protect, createBot);

// --- NEW OAUTH ROUTES ---
// 1. Initiates the redirect to Binance/OKX
router.get('/exchange/auth/:exchange', authExchange); 

// 2. Handles the return from Binance/OKX
router.get('/exchange/callback/:exchange', authExchangeCallback);

module.exports = router;
