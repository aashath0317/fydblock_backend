// backend/routes/adminRoutes.js
const router = require('express').Router();
const { getOverview, getUsers, getAdminBots, deleteUser, updateUser, getSystemLogs } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');

router.get('/overview', protect, admin, getOverview);
router.get('/users', protect, admin, getUsers);
router.get('/bots', protect, admin, getAdminBots);
router.delete('/users/:id', protect, admin, deleteUser);
router.put('/users/:id', protect, admin, updateUser);
router.get('/logs', protect, admin, getSystemLogs);

module.exports = router;
