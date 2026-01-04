const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper to generate random code (kept for future use)
const generateReferralCode = () => {
    return crypto.randomBytes(4).toString('hex');
};

// 1. REGISTER USER
const register = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert into DB (Default role is usually 'user' in DB schema)
        const newUser = await pool.query(
            'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, role',
            [email, hashedPassword]
        );

        // Generate Token
        const token = jwt.sign({ id: newUser.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ 
            token, 
            user: {
                id: newUser.rows[0].id,
                email: newUser.rows[0].email,
                role: newUser.rows[0].role // Send role (likely 'user')
            }
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// 2. LOGIN USER
const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check user
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.rows[0].password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // Generate Token
        const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // ? CRITICAL FIX: Send 'role' in the response
        res.json({ 
            token, 
            user: { 
                id: user.rows[0].id, 
                email: user.rows[0].email, 
                role: user.rows[0].role 
            } 
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// 3. GOOGLE LOGIN/REGISTER
const googleAuth = async (req, res) => {
    const { token } = req.body; 

    try {
        // Verify the token
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const googleUser = await response.json();

        if (!googleUser.email_verified) {
            return res.status(400).json({ message: 'Google account not verified' });
        }

        const { email, sub: googleId } = googleUser;

        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        let userId;
        let role = 'user'; // Default role

        if (userCheck.rows.length > 0) {
            // User exists
            userId = userCheck.rows[0].id;
            role = userCheck.rows[0].role; // ? Fetch existing role (e.g. 'admin')

            if (!userCheck.rows[0].google_id) {
                await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
            }
        } else {
            // Create new user
            const newUser = await pool.query(
                'INSERT INTO users (email, google_id) VALUES ($1, $2) RETURNING id',
                [email, googleId]
            );
            userId = newUser.rows[0].id;
        }

        const appToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // ? CRITICAL FIX: Send 'role' in the response
        res.json({ 
            token: appToken, 
            user: { 
                id: userId, 
                email, 
                role 
            } 
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Google Auth Error');
    }
};

module.exports = { register, login, googleAuth };