/**
 * Exchange Cache Utility
 * 
 * Provides a singleton cache for CCXT exchange instances to prevent memory leaks
 * from creating new instances on every request. Instances are cached by exchange ID
 * and reused across requests.
 */
const ccxt = require('ccxt');

// Cache for public (unauthenticated) exchange instances
// Key: `${exchangeId}` or `${exchangeId}_sandbox`
const publicExchangeCache = new Map();

// Cache for authenticated exchange instances per user
// Key: `${exchangeId}_${userId}_${mode}`
const authenticatedExchangeCache = new Map();

// TTL for cached instances (1 hour) - clears stale authenticated instances
const CACHE_TTL_MS = 60 * 60 * 1000;

// Max cache size to prevent unbounded growth
const MAX_AUTH_CACHE_SIZE = 100;

/**
 * Get or create a public (unauthenticated) exchange instance.
 * Used for public market data endpoints.
 * 
 * @param {string} exchangeId - The CCXT exchange ID (e.g., 'binance')
 * @param {boolean} sandbox - Whether to use sandbox/testnet mode
 * @returns {Object} CCXT exchange instance
 */
function getPublicExchange(exchangeId, sandbox = false) {
    const normalizedId = exchangeId.toLowerCase();
    const cacheKey = sandbox ? `${normalizedId}_sandbox` : normalizedId;

    if (publicExchangeCache.has(cacheKey)) {
        return publicExchangeCache.get(cacheKey);
    }

    if (!ccxt[normalizedId]) {
        throw new Error(`Exchange ${exchangeId} not supported`);
    }

    const exchange = new ccxt[normalizedId]({
        enableRateLimit: true
    });

    if (sandbox && exchange.has['sandbox']) {
        exchange.setSandboxMode(true);
    }

    publicExchangeCache.set(cacheKey, exchange);
    return exchange;
}

/**
 * Get or create an authenticated exchange instance for a specific user.
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.exchangeId - The CCXT exchange ID
 * @param {string} config.userId - The user ID for cache key
 * @param {string} config.apiKey - API key
 * @param {string} config.apiSecret - API secret
 * @param {string} [config.password] - API password/passphrase (if required)
 * @param {boolean} [config.sandbox] - Whether to use sandbox mode
 * @returns {Object} Authenticated CCXT exchange instance
 */
function getAuthenticatedExchange({ exchangeId, userId, apiKey, apiSecret, password, sandbox = false }) {
    const normalizedId = exchangeId.toLowerCase();
    const mode = sandbox ? 'paper' : 'live';
    const cacheKey = `${normalizedId}_${userId}_${mode}`;

    // Check if we have a cached instance with the same credentials
    if (authenticatedExchangeCache.has(cacheKey)) {
        const cached = authenticatedExchangeCache.get(cacheKey);

        // Refresh timestamp to keep it alive
        cached.lastUsed = Date.now();

        // Verify credentials match (in case user updated keys)
        if (cached.exchange.apiKey === apiKey && cached.exchange.secret === apiSecret) {
            return cached.exchange;
        }

        // Credentials changed, remove old instance
        authenticatedExchangeCache.delete(cacheKey);
    }

    // Clean old entries if cache is too large
    if (authenticatedExchangeCache.size >= MAX_AUTH_CACHE_SIZE) {
        cleanAuthenticatedCache();
    }

    if (!ccxt[normalizedId]) {
        throw new Error(`Exchange ${exchangeId} not supported`);
    }

    const exchange = new ccxt[normalizedId]({
        apiKey,
        secret: apiSecret,
        password,
        enableRateLimit: true
    });

    if (sandbox) {
        if (exchange.has['sandbox']) {
            exchange.setSandboxMode(true);
        } else if (normalizedId === 'okx') {
            // Manual OKX Sandbox
            exchange.options['sandboxMode'] = true;
            exchange.headers = exchange.headers || {};
            exchange.headers['x-simulated-trading'] = '1';
        }
    }

    authenticatedExchangeCache.set(cacheKey, {
        exchange,
        lastUsed: Date.now()
    });

    return exchange;
}

/**
 * Clean expired entries from the authenticated cache
 */
function cleanAuthenticatedCache() {
    const now = Date.now();
    const entriesToDelete = [];

    for (const [key, value] of authenticatedExchangeCache) {
        if (now - value.lastUsed > CACHE_TTL_MS) {
            entriesToDelete.push(key);
        }
    }

    // If still too large after TTL cleanup, remove oldest entries
    if (entriesToDelete.length < authenticatedExchangeCache.size / 2) {
        const entries = Array.from(authenticatedExchangeCache.entries())
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

        // Remove oldest half
        const toRemove = Math.floor(entries.length / 2);
        for (let i = 0; i < toRemove; i++) {
            entriesToDelete.push(entries[i][0]);
        }
    }

    for (const key of entriesToDelete) {
        authenticatedExchangeCache.delete(key);
    }

    console.log(`[ExchangeCache] Cleaned ${entriesToDelete.length} expired entries`);
}

/**
 * Invalidate cached exchange for a user (e.g., when they update API keys)
 * 
 * @param {string} exchangeId - The exchange ID
 * @param {string} userId - The user ID
 */
function invalidateUserExchange(exchangeId, userId) {
    const cleanId = (exchangeId || '').replace('_paper', '').toLowerCase();
    authenticatedExchangeCache.delete(`${cleanId}_${userId}_live`);
    authenticatedExchangeCache.delete(`${cleanId}_${userId}_paper`);
}

/**
 * Clear all caches (for graceful shutdown)
 */
function clearAllCaches() {
    publicExchangeCache.clear();
    authenticatedExchangeCache.clear();
    console.log('[ExchangeCache] All caches cleared');
}

/**
 * Get cache statistics for monitoring
 */
function getCacheStats() {
    return {
        publicCacheSize: publicExchangeCache.size,
        authenticatedCacheSize: authenticatedExchangeCache.size
    };
}

// Clean cache periodically to free memory from stale instances
const cleanupTimer = setInterval(cleanAuthenticatedCache, CACHE_TTL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = {
    getPublicExchange,
    getAuthenticatedExchange,
    invalidateUserExchange,
    clearAllCaches,
    getCacheStats
};

