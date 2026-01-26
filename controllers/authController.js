const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');
const { getWelcomeEmailHtml, getPasswordResetEmailHtml } = require('../utils/emailTemplates');

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

// --- SESSION LOGGING HELPER ---
const logSession = async (req, userId) => {
    try {
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
        const sessionId = crypto.randomBytes(16).toString('hex');

        // Simple UA Parsing
        let browser = 'Unknown';
        let os = 'Unknown';
        let deviceType = 'Desktop';

        if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Edge')) browser = 'Edge';

        if (userAgent.includes('Windows')) os = 'Windows';
        else if (userAgent.includes('Macintosh')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) { os = 'Android'; deviceType = 'Mobile'; }
        else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) { os = 'iOS'; deviceType = 'Mobile'; }

        const sessionRes = await pool.query(
            `INSERT INTO user_sessions (user_id, session_id, ip_address, user_agent, device_type, browser, os, last_active) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
            [userId, sessionId, ipAddress, userAgent, deviceType, browser, os]
        );
        return sessionRes.rows[0].id;
    } catch (err) {
        console.error("Session Log Error:", err.message);
        return null;
    }
};

// 1. REGISTER USER
const register = async (req, res) => {
    const { email, password, first_name, last_name, referral_code } = req.body;
    console.log(`[Register] Attempting register for ${email}. Referral Code: ${referral_code}`);

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

        // Refined Logic based on requirements
        let slugCandidate = '';
        if (first_name) slugCandidate = first_name;
        else if (last_name) slugCandidate = last_name;
        else slugCandidate = email.split('@')[0]; // Fallback

        const slug = await generateUniqueSlug(slugCandidate);

        // Handle Referral
        let referredBy = null;
        if (referral_code) {
            const cleanCode = referral_code.trim();
            console.log(`[Register] Looking for referrer with slug: '${cleanCode}'`);
            const referrerRes = await pool.query('SELECT id FROM users WHERE slug = $1', [cleanCode]);
            if (referrerRes.rows.length > 0) {
                referredBy = referrerRes.rows[0].id;
                console.log(`[Register] Found Referrer ID: ${referredBy}`);
            } else {
                console.warn(`[Register] Referrer NOT FOUND for slug: '${cleanCode}'`);
            }
        }

        // Insert into DB
        const newUser = await pool.query(
            'INSERT INTO users (email, password, slug, full_name, referred_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, slug',
            [email, hashedPassword, slug, `${first_name || ''} ${last_name || ''}`.trim(), referredBy]
        );

        // Generate Token
        const token = jwt.sign({ id: newUser.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Generate Verification Code (6 Digits)
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Update user with verification token (storing code in same column)
        await pool.query('UPDATE users SET verification_token = $1, is_verified = FALSE WHERE id = $2', [verificationCode, newUser.rows[0].id]);

        // Send Welcome / Verification Email (Async - don't block response)
        try {
            const name = first_name || 'Trader';
            const welcomeHtml = getWelcomeEmailHtml(name, verificationCode);
            console.log(`[Register] Sending verification email to ${email}`);

            await sendEmail({
                email: email,
                subject: 'Verify your Fydblock Email',
                message: welcomeHtml
            });

        } catch (emailErr) {
            console.error('[Register] Failed to send verification email:', emailErr.message);
        }

        // Log session
        const sessionDbId = await logSession(req, newUser.rows[0].id);

        res.json({
            token,
            sessionId: sessionDbId,
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

        // Check if verified
        const isVerified = user.rows[0].is_verified;

        // If NOT verified, send a fresh code so they can verify immediately
        if (!isVerified) {
            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
            await pool.query('UPDATE users SET verification_token = $1 WHERE id = $2', [verificationCode, user.rows[0].id]);

            try {
                const name = user.rows[0].first_name || user.rows[0].slug || 'Trader';
                const welcomeHtml = getWelcomeEmailHtml(name, verificationCode);
                await sendEmail({
                    email: email,
                    subject: 'Verify your Fydblock Email',
                    message: welcomeHtml
                });
            } catch (emailErr) {
                console.error('[Login] Failed to send verification email:', emailErr.message);
            }
        }

        // Log session
        const sessionDbId = await logSession(req, user.rows[0].id);

        // ? CRITICAL FIX: Send 'role' and 'is_verified' in the response
        res.json({
            token,
            sessionId: sessionDbId, // <--- NEW
            user: {
                id: user.rows[0].id,
                email: user.rows[0].email,
                role: user.rows[0].role,
                slug: user.rows[0].slug,
                is_verified: user.rows[0].is_verified
            }
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// 3. GOOGLE LOGIN/REGISTER
const googleAuth = async (req, res) => {
    const { token, referral_code } = req.body;

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

            // Handle Referral
            let referredBy = null;
            if (referral_code) {
                const referrerRes = await pool.query('SELECT id FROM users WHERE slug = $1', [referral_code]);
                if (referrerRes.rows.length > 0) {
                    referredBy = referrerRes.rows[0].id;
                }
            }

            const newUser = await pool.query(
                'INSERT INTO users (email, google_id, slug, full_name, referred_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [email, googleId, slug, name, referredBy]
            );
            userId = newUser.rows[0].id;
        }

        // Log session
        const sessionDbId = await logSession(req, userId);

        const appToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({
            token: appToken,
            sessionId: sessionDbId, // <--- NEW
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

// 4. FORGOT PASSWORD
const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        // 1. Get user based on POSTed email
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 2. Generate the random reset token
        const resetToken = crypto.randomBytes(32).toString('hex');

        // 3. Hash it and set to reset_password_token field in DB
        // hash using sha256
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // Expires in 1 hour
        // Note: We need to store BIGINT or TIMESTAMP. Let's assume BIGINT for now as per plan, 
        // or usage of CURRENT_TIMESTAMP + interval. 
        // JS Date.now() + 1 hour = milliseconds.
        const expires = Date.now() + 3600000;

        // Update user
        await pool.query(
            'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE email = $3',
            [hashedToken, expires, email]
        );

        // 4. Send it to user's email
        // Logic for reset URL
        // const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
        // BUT we need frontend URL. Typically this comes from env or we assume localhost/production url.
        // Let's use a standard construct or env.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;


        const message = getPasswordResetEmailHtml(resetUrl);


        try {
            await sendEmail({
                email: user.rows[0].email,
                subject: 'Password Reset Request',
                message
            });

            res.status(200).json({ status: 'success', message: 'Token sent to email!' });
        } catch (err) {
            // cleanup if email fails
            await pool.query(
                'UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL WHERE email = $1',
                [email]
            );
            console.error('Email send error:', err);
            return res.status(500).json({ message: 'There was an error sending the email. Try again later!' });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// 5. RESET PASSWORD
const resetPassword = async (req, res) => {
    // 1. Get user based on token
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    try {
        // Find user with token and valid expiry
        // Note: Date.now() is ms. Ensure DB column is big enough or use timestamp comparison.
        // If 'reset_password_expires' is BIGINT (ms):
        const user = await pool.query(
            'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > $2',
            [hashedToken, Date.now()]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({ message: 'Token is invalid or has expired' });
        }

        // 2. Set new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(req.body.password, salt);

        // 3. Update DB, clear reset fields
        await pool.query(
            'UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
            [hashedPassword, user.rows[0].id]
        );

        // 4. Log user in? Or just send success.
        // Just send success, let them login.

        // Optional: Reset all exchange connections as per warning in UI? 
        // "Performing a password reset via email confirmation will reset the API connections..."
        // If that is a requirement:
        // await pool.query('DELETE FROM user_exchanges WHERE user_id = $1', [user.rows[0].id]);

        res.status(200).json({ status: 'success', message: 'Password Reset Successfully!' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

// 6. VERIFY EMAIL
// 6. VERIFY EMAIL (OTP)
const verifyEmail = async (req, res) => {
    const { code } = req.body; // User enters code
    const userId = req.user.id; // From Bearer Token

    try {
        const user = await pool.query('SELECT verification_token FROM users WHERE id = $1', [userId]);

        if (user.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Compare stored code
        // Note: verification_token column is holding the OTP code now
        if (user.rows[0].verification_token !== code) {
            return res.status(400).json({ message: 'Invalid verification code' });
        }

        await pool.query('UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE id = $1', [userId]);

        res.json({ message: 'Email verified successfully', is_verified: true });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

// 7. RESEND VERIFICATION CODE
const resendVerificationCode = async (req, res) => {
    const userId = req.user.id;
    try {
        const user = await pool.query('SELECT email, full_name, slug FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) return res.status(404).json({ message: 'User not found' });

        const { email, full_name, slug } = user.rows[0];
        // Use full_name or slug or just 'Trader' for name
        const name = full_name || slug || 'Trader';

        // Generate New Code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Update DB
        await pool.query('UPDATE users SET verification_token = $1 WHERE id = $2', [verificationCode, userId]);

        // Send Email
        const welcomeHtml = getWelcomeEmailHtml(name, verificationCode);
        await sendEmail({
            email: email,
            subject: 'Resend: Verify your Fydblock Email',
            message: welcomeHtml
        });

        res.json({ message: 'Verification code sent successfully' });
    } catch (err) {
        console.error("Resend Email Error:", err.message);
        res.status(500).json({ message: `Failed to send email: ${err.message}` });
    }
};

// 8. CHANGE PASSWORD (LOGGED IN)
const changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    try {
        // 1. Get user
        const user = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) return res.status(404).json({ message: 'User not found' });

        // 2. Verify old password
        // If user has no password (e.g. Google Auth), we might want to allow setting one if they specifically used a "Set Password" flow,
        // but here we assume standard change flow which requires knowing the old one.
        if (!user.rows[0].password) {
            return res.status(400).json({ message: 'You are logged in via social provider and do not have a password set.' });
        }

        const isMatch = await bcrypt.compare(oldPassword, user.rows[0].password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // 3. Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 4. Update
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

        res.json({ message: 'Password changed successfully' });

    } catch (err) {
        console.error("Change Password Error:", err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { register, login, googleAuth, forgotPassword, resetPassword, verifyEmail, resendVerificationCode, changePassword };