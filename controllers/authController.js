const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper to generate random code (kept for future use)
// Helper to generate distinct slug
const generateUniqueSlug = async (baseName) => {
    let slug = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let counter = 1;
    let isUnique = false;
    let finalSlug = slug;

    while (!isUnique) {
        const check = await pool.query('SELECT slug FROM users WHERE slug = $1', [finalSlug]);
        if (check.rows.length === 0) {
            isUnique = true;
        } else {
            finalSlug = `${slug}_${counter}`;
            counter++;
        }
    }
    return finalSlug;
};

// 1. REGISTER USER
const register = async (req, res) => {
    const { email, password, first_name, last_name } = req.body;

    try {
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate Slug
        let baseSlug = 'user';
        if (first_name) baseSlug = first_name;
        else if (last_name) baseSlug = last_name;
        else if (email) baseSlug = email.split('@')[0];

        if (first_name && last_name) baseSlug = `${first_name}${last_name}`; // Priority 3 override? Logic says 1: first, 2: last, 3: combo. Let's stick to a robust fallback.

        // Refined Logic based on requirements:
        // Priority 1: first_name
        // Priority 2: last_name
        // Priority 3: first + last

        let slugCandidate = '';
        if (first_name) slugCandidate = first_name;
        else if (last_name) slugCandidate = last_name;
        else slugCandidate = email.split('@')[0]; // Fallback

        // If collision check happens inside generateUniqueSlug, we just need a good base.
        // Actually the requirement says: "If jack exists -> jack_1".
        // So passing just "jack" (first name) is correct.

        const slug = await generateUniqueSlug(slugCandidate);


        // Insert into DB
        const newUser = await pool.query(
            'INSERT INTO users (email, password, slug, full_name) VALUES ($1, $2, $3, $4) RETURNING id, email, role, slug',
            [email, hashedPassword, slug, `${first_name || ''} ${last_name || ''}`.trim()]
        );

        // Generate Token
        const token = jwt.sign({ id: newUser.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({
            token,
            user: {
                id: newUser.rows[0].id,
                email: newUser.rows[0].email,
                role: newUser.rows[0].role,
                slug: newUser.rows[0].slug
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
                role: user.rows[0].role,
                slug: user.rows[0].slug
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

        const { email, sub: googleId, given_name, family_name, name } = googleUser;

        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        let userId;
        let role = 'user';
        let slug;

        if (userCheck.rows.length > 0) {
            // User exists
            userId = userCheck.rows[0].id;
            role = userCheck.rows[0].role;
            slug = userCheck.rows[0].slug;

            if (!userCheck.rows[0].google_id) {
                await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
            }

            // Backfill slug if missing (for existing users)
            if (!slug) {
                const base = given_name || family_name || email.split('@')[0];
                slug = await generateUniqueSlug(base);
                await pool.query('UPDATE users SET slug = $1 WHERE id = $2', [slug, userId]);
            }

        } else {
            // Create new user
            const base = given_name || family_name || email.split('@')[0];
            slug = await generateUniqueSlug(base);

            const newUser = await pool.query(
                'INSERT INTO users (email, google_id, slug, full_name) VALUES ($1, $2, $3, $4) RETURNING id',
                [email, googleId, slug, name]
            );
            userId = newUser.rows[0].id;
        }

        const appToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({
            token: appToken,
            user: {
                id: userId,
                email,
                role,
                slug
            }
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Google Auth Error');
    }
};

module.exports = { register, login, googleAuth };