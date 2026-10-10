/*
 * Circuit breaker transitions as Lua scripts, so each check-and-update runs
 * atomically inside Redis even with several gateway instances sharing state.
 * KEYS[1] = breaker hash (state, opened_at, trial_at), KEYS[2] = failure timestamps (sorted set).
 */

/** ARGV: now, cooldownMs, trialTimeoutMs. Returns 1 if a call may go ahead. */
export const ALLOW_LUA = `
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
local now = tonumber(ARGV[1])
if state == 'closed' then return 1 end
if state == 'open' then
  local opened = tonumber(redis.call('HGET', KEYS[1], 'opened_at') or '0')
  if now - opened < tonumber(ARGV[2]) then return 0 end
  redis.call('HSET', KEYS[1], 'state', 'half_open', 'trial_at', now)
  return 1
end
local trial = tonumber(redis.call('HGET', KEYS[1], 'trial_at') or '0')
if now - trial >= tonumber(ARGV[3]) then
  redis.call('HSET', KEYS[1], 'trial_at', now)
  return 1
end
return 0
`;

/** Returns the state after the success. */
export const SUCCESS_LUA = `
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
if state == 'half_open' then
  redis.call('HSET', KEYS[1], 'state', 'closed')
  redis.call('HDEL', KEYS[1], 'opened_at', 'trial_at')
  redis.call('DEL', KEYS[2])
  return 'closed'
end
return state
`;

/** ARGV: now, failureThreshold, windowMs, unique member. Returns the state after the failure. */
export const FAILURE_LUA = `
local now = tonumber(ARGV[1])
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
if state == 'half_open' then
  redis.call('HSET', KEYS[1], 'state', 'open', 'opened_at', now)
  redis.call('HDEL', KEYS[1], 'trial_at')
  return 'open'
end
if state == 'open' then return 'open' end
redis.call('ZADD', KEYS[2], now, ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[3]))
redis.call('PEXPIRE', KEYS[2], ARGV[3])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then
  redis.call('HSET', KEYS[1], 'state', 'open', 'opened_at', now)
  redis.call('DEL', KEYS[2])
  return 'open'
end
return 'closed'
`;
