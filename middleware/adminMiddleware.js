// backend/middleware/adminMiddleware.js
const pool = require('../db');

const admin = async (req, res, next) => {
    try {
        // req.user.id is set by the 'protect' middleware
        const user = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
        
        if (user.rows.length > 0 && user.rows[0].role === 'admin') {
            next();
        } else {
            res.status(403).json({ message: 'Not authorized as admin' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

module.exports = { admin };
