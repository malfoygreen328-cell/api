// src/utils/recommendationCache.js
//
// Small, dependency-free cache facade for the recommendation engine.
//
// Strategy (chosen to avoid introducing infrastructure complexity):
//   1. If REDIS_URL is configured AND reachable, use the shared ioredis client.
//   2. Otherwise fall back to a bounded in-process TTL map.
//
// Redis is only imported lazily (and only when REDIS_URL exists) so that a
// deployment without Redis never opens a background reconnect loop.
//
// The cache only ever stores NON-SENSITIVE derived data: product id lists,
// scores and collection payloads. It never stores credentials or PII.

let redis = null;
let redisUnavailable = false;
let redisInitialised = false;

const MEMORY_MAX_ENTRIES = 500;

// key -> { value, expiresAt }
const memory = new Map();

const memoryGet = (key) => {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
};

const memorySet = (key, value, ttlSeconds) => {
  // Cheap FIFO eviction once the bound is exceeded.
  if (memory.size >= MEMORY_MAX_ENTRIES && !memory.has(key)) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
};

const initRedis = async () => {
  if (redisInitialised) return redis;
  redisInitialised = true;

  if (!process.env.REDIS_URL) {
    redisUnavailable = true;
    return null;
  }

  try {
    const mod = await import("./redisClient.js");
    redis = mod.default;
  } catch (err) {
    console.warn("recommendationCache: Redis unavailable, using memory cache");
    redisUnavailable = true;
    redis = null;
  }
  return redis;
};

/**
 * Read a cached value (already JSON-decoded) or null on miss/expiry.
 */
export const cacheGet = async (key) => {
  try {
    const client = await initRedis();
    if (client && !redisUnavailable) {
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (err) {
    redisUnavailable = true;
  }
  return memoryGet(key);
};

/**
 * Store a value for `ttlSeconds`. Failures are swallowed - caching must never
 * break a request.
 */
export const cacheSet = async (key, value, ttlSeconds = 120) => {
  try {
    const client = await initRedis();
    if (client && !redisUnavailable) {
      await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    }
  } catch (err) {
    redisUnavailable = true;
  }
  memorySet(key, value, ttlSeconds);
};

/**
 * Wrap a producer function with the cache. Returns the cached value when fresh,
 * otherwise computes, stores and returns it. `cacheNull` controls whether an
 * empty result is cached (useful to damp negative-lookup storms).
 */
export const cacheWrap = async (key, ttlSeconds, producer, cacheNull = false) => {
  const cached = await cacheGet(key);
  if (cached !== null && cached !== undefined) return cached;

  const value = await producer();
  const isEmpty = Array.isArray(value) ? value.length === 0 : value == null;
  if (!isEmpty || cacheNull) {
    await cacheSet(key, value, ttlSeconds);
  }
  return value;
};

export default { cacheGet, cacheSet, cacheWrap };
