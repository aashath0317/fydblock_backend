// backend/controllers/partnerController.js
const pool = require('../db');

// @desc    Get Partner Dashboard Stats
// @route   GET /api/partner/stats
const getPartnerStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get User's Wallet & Info
        const userRes = await pool.query('SELECT referral_code, partner_balance, total_earnings FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];

        // 2. Count Active Referrals
        const referralsRes = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [userId]);
        const activeReferrals = parseInt(referralsRes.rows[0].count);

        // 3. Get Recent Conversions (Simplified logic)
        // In a real app, you would join with a 'payments' table to calculate conversion rate
        const conversionRate = activeReferrals > 0 ? "4.2%" : "0%"; 

        res.json({
            total_earnings: user.total_earnings,
            pending_payout: user.partner_balance,
            active_referrals: activeReferrals,
            conversion_rate: conversionRate,
            referral_code: user.referral_code,
            referral_link: `https://fydblock.com/r/${user.referral_code}`
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Referred Clients List
// @route   GET /api/partner/clients
const getPartnerClients = async (req, res) => {
    try {
        // Fetch users referred by the current user
        const clients = await pool.query(
            `SELECT full_name, country, created_at, 'Pro Plan' as plan, 'Active' as status 
             FROM users 
             WHERE referred_by = $1 
             ORDER BY created_at DESC LIMIT 50`,
            [req.user.id]
        );

        res.json(clients.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getPartnerStats, getPartnerClients };
