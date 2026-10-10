/**
 * Token bucket: a key holds up to `capacity` tokens, refilled continuously at
 * `refillPerMs`. Each request takes one. This allows short bursts up to the
 * capacity while holding the long-run rate to the refill rate.
 */
export interface BucketConfig {
  capacity: number;
  refillPerMs: number;
}

export interface BucketState {
  tokens: number;
  ts: number;
}

export interface BucketDecision {
  allowed: boolean;
  remaining: number;
  /** When rejected, how long until one token is available. */
  retryAfterMs: number;
  state: BucketState;
}

export function bucketFor(ratePerMin: number, burst: number): BucketConfig {
  return { capacity: burst, refillPerMs: ratePerMin / 60_000 };
}

/** The same arithmetic as TOKEN_BUCKET_LUA, used when Redis is unavailable. */
export function takeToken(
  state: BucketState | undefined,
  cfg: BucketConfig,
  now: number,
  cost = 1,
): BucketDecision {
  const prev = state ?? { tokens: cfg.capacity, ts: now };
  const elapsed = Math.max(0, now - prev.ts);
  let tokens = Math.min(cfg.capacity, prev.tokens + elapsed * cfg.refillPerMs);
  let allowed = false;
  let retryAfterMs = 0;
  if (tokens >= cost) {
    tokens -= cost;
    allowed = true;
  } else {
    retryAfterMs = Math.ceil((cost - tokens) / cfg.refillPerMs);
  }
  return { allowed, remaining: Math.floor(tokens), retryAfterMs, state: { tokens, ts: now } };
}

/**
 * Check-and-take in one atomic step inside Redis. Doing GET, compute and SET
 * from Node instead would let two concurrent requests both see the last token.
 * KEYS[1] = bucket hash; ARGV = capacity, refillPerMs, now, cost.
 * Returns { allowed (0/1), tokens left (string, keeps fractions), retryAfterMs }.
 */
export const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)
local allowed = 0
local retry_after = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after = math.ceil((cost - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate) + 1000)
return { allowed, tostring(tokens), retry_after }
`;
