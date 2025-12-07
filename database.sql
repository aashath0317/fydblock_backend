CREATE TABLE user_exchanges (
    exchange_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange_name VARCHAR(50),
    api_key TEXT,
    api_secret TEXT,
    connection_type VARCHAR(20), -- 'manual' or 'oauth'
    access_token TEXT,
    refresh_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
    subscription_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    plan_type VARCHAR(50),
    billing_cycle VARCHAR(20),
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE bots (
    bot_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange_connection_id INTEGER REFERENCES user_exchanges(exchange_id),
    bot_name VARCHAR(100),
    quote_currency VARCHAR(10),
    bot_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ready',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
