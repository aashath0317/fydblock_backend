-- 1. Users Table (Updated for Profile & Auth)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- Nullable for Google Auth users
    google_id VARCHAR(255),
    full_name VARCHAR(255),
    country VARCHAR(100),
    phone_number VARCHAR(50),
    slug VARCHAR(255) UNIQUE,
    is_verified BOOLEAN DEFAULT FALSE, -- Email Verification Status
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires BIGINT,
    referred_by INTEGER REFERENCES users(id), -- Added for Affiliate System
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. User Exchanges (With Passphrase)
CREATE TABLE user_exchanges (
    exchange_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    exchange_name VARCHAR(50),
    api_key TEXT,
    api_secret TEXT,
    passphrase TEXT, -- Required for OKX/KuCoin
    connection_type VARCHAR(20), -- 'manual' or 'oauth'
    access_token TEXT,
    refresh_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Subscriptions
CREATE TABLE subscriptions (
    subscription_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50),
    billing_cycle VARCHAR(20),
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

-- 4. Bots (Linked to User & Exchange)
CREATE TABLE bots (
    bot_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    exchange_connection_id INTEGER REFERENCES user_exchanges(exchange_id) ON DELETE SET NULL,
    bot_name VARCHAR(100),
    quote_currency VARCHAR(10),
    bot_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ready',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. User Assets (Optional cache for quick loading)
CREATE TABLE user_assets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    asset_id VARCHAR(50),  
    symbol VARCHAR(10),    
    name VARCHAR(50),      
    balance DECIMAL(18, 8) DEFAULT 0,
    icon_url TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Portfolio Snapshots (For History Chart)
CREATE TABLE portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    total_value DECIMAL(18, 2),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
-- Set your specific user as admin manually
UPDATE users SET role = 'admin' WHERE email = 'your_email@example.com';



 CREATE TABLE IF NOT EXISTS portfolio_snapshots_live (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    total_value DECIMAL(18, 2),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots_paper (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    total_value DECIMAL(18, 2),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
