// routes/userRoutes.js
const router = require('express').Router();
const { getMe, updateProfile, addExchange, createBot } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// All routes here are protected
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/exchange', protect, addExchange);
router.post('/bot', protect, createBot);

module.exports = router;
