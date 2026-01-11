const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
// 1. Update the import to include googleAuth
const { register, login, googleAuth, forgotPassword, resetPassword, verifyEmail, resendVerificationCode } = require('../controllers/authController');

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// 2. Add this new route
// POST /api/auth/google
router.post('/google', googleAuth);

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// POST /api/auth/reset-password/:token
router.post('/reset-password/:token', resetPassword);

// POST /api/auth/verify-email
router.post('/verify-email', protect, verifyEmail);

// POST /api/auth/verify-email/resend
router.post('/verify-email/resend', protect, resendVerificationCode);

module.exports = router;
