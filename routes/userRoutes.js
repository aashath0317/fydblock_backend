// routes/userRoutes.js
const router = require('express').Router();

// 1. Import 'getDashboard' from the controller
const { 
    getMe, 
    updateProfile, 
    addExchange, 
    createBot, 
    authExchange, 
    authExchangeCallback,
    getDashboard
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/exchange', protect, addExchange);
router.post('/bot', protect, createBot);

// 2. Add the Dashboard Route
router.get('/dashboard', protect, getDashboard);

// --- OAUTH ROUTES ---
router.get('/exchange/auth/:exchange', authExchange); 
router.get('/exchange/callback/:exchange', authExchangeCallback);

module.exports = router;
