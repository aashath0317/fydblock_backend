// backend/routes/partnerRoutes.js
const router = require('express').Router();
const { getPartnerStats, getPartnerClients } = require('../controllers/partnerController');
const { protect } = require('../middleware/authMiddleware');

router.get('/stats', protect, getPartnerStats);
router.get('/clients', protect, getPartnerClients);

module.exports = router;