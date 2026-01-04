const pool = require('../db');

// @desc    Get Partner Dashboard Stats
// @route   GET /api/partner/stats
const getPartnerStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get User's Wallet & Info
        const userRes = await pool.query('SELECT referral_code, partner_balance, total_earnings FROM users WHERE id = $1', [userId]);
        
        if (userRes.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const user = userRes.rows[0];

        // 2. Count Active Referrals
        const referralsRes = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [userId]);
        const activeReferrals = parseInt(referralsRes.rows[0].count);

        // 3. Generate Link
        // Ensure referral_code exists. If null, you might want to generate one here or handle it.
        const refCode = user.referral_code || 'generate-one'; 

        res.json({
            total_earnings: user.total_earnings || 0,
            pending_payout: user.partner_balance || 0,
            active_referrals: activeReferrals,
            conversion_rate: activeReferrals > 0 ? "4.2%" : "0%", // Placeholder logic
            referral_code: refCode,
            referral_link: `https://fydblock.com/r/${refCode}`
        });

    } catch (err) {
        console.error("Partner Stats Error:", err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Referred Clients List
// @route   GET /api/partner/clients
const getPartnerClients = async (req, res) => {
    try {
        const clients = await pool.query(
            `SELECT full_name, country, created_at, 'Pro Plan' as plan 
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