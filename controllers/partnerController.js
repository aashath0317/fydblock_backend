const pool = require('../db');

// @desc    Get Partner Dashboard Stats
// @route   GET /api/partner/stats
const getPartnerStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get User's Wallet & Info
        const userRes = await pool.query('SELECT slug, partner_balance, total_earnings FROM users WHERE id = $1', [userId]);

        if (userRes.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const user = userRes.rows[0];

        // 2. Count Active Referrals
        const referralsRes = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [userId]);
        const activeReferrals = parseInt(referralsRes.rows[0].count);

        // 3. Generate Link
        // Ensure referral_code exists. If null, you might want to generate one here or handle it.
        const refCode = user.slug || 'generate-one';

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
        console.log(`[Partner] Fetching clients for User ID: ${req.user.id}`);
        const clients = await pool.query(
            `SELECT u.email, u.full_name, u.country, u.created_at, s.plan_type, s.status as sub_status
             FROM users u
             LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
             WHERE u.referred_by = $1 
             ORDER BY u.created_at DESC LIMIT 50`,
            [req.user.id]
        );

        console.log(`[Partner] Found ${clients.rows.length} clients.`);

        // Map through clients to format data and calculate earnings (Simulated for now based on Plan)
        const formattedClients = clients.rows.map(client => {
            let commission = 0;
            const plan = client.plan_type || 'Free';

            // Simple logic to determine commission based on plan (You can adjust these values)
            if (plan === 'Pro Plan' || plan === 'Pro') commission = 12;
            if (plan === 'Basic') commission = 5;
            if (plan === 'Premium') commission = 25;

            return {
                user: client.full_name || client.email || 'Anonymous',
                country: client.country || 'Unknown',
                date: new Date(client.created_at).toLocaleDateString(), // Format as needed, e.g., 2025.12.7
                plan: plan,
                status: client.sub_status === 'active' ? 'Active' : 'Inactive', // Or use sub_status directly if mapped
                earnings: `$${commission}` // Formatted earning
            };
        });

        res.json(formattedClients);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getPartnerStats, getPartnerClients };