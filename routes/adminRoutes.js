// backend/routes/adminRoutes.js
const router = require('express').Router();
const { getOverview, getUsers, getAdminBots } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');

router.get('/overview', protect, admin, getOverview);
router.get('/users', protect, admin, getUsers);
router.get('/bots', protect, admin, getAdminBots);

module.exports = router;
