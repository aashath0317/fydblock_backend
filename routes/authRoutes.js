const router = require('express').Router();
// 1. Update the import to include googleAuth
const { register, login, googleAuth } = require('../controllers/authController');

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// 2. Add this new route
// POST /api/auth/google
router.post('/google', googleAuth);

module.exports = router;
