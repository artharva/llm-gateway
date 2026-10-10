# Rate limiting: why a token bucket

Each API key gets a token bucket in Redis: `burst` tokens of capacity, refilled continuously at `rate_per_min / 60` tokens per second. A request takes one token; with none left, the gateway answers `429` with `Retry-After` set to the time until the next token.

## The three common algorithms

| Algorithm                 | How it counts                                                    | Strength                                                                                                | Weakness                                                                                              |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Fixed window              | One counter per key per clock minute, reset on the minute        | One `INCR` + `EXPIRE`; trivial                                                                          | A client can send the full limit at 12:00:59 and again at 12:01:00, so twice the limit in two seconds |
| Sliding window log        | A sorted set of request timestamps; count those in the last 60 s | Exact; no boundary burst                                                                                | Memory grows with the limit (60,000/min means 60,000 entries per key) and each check scans the set    |
| Sliding window counter    | Weighted mix of this window's and last window's counters         | Cheap and close to exact                                                                                | An approximation; harder to explain and to give an exact `Retry-After`                                |
| **Token bucket** (chosen) | Two numbers per key: tokens left and last refill time            | O(1) memory, smooth refill, bursts allowed up to a set size, exact time-to-next-token for `Retry-After` | Needs fractional arithmetic, and the check-and-take must be atomic                                    |

## Why token bucket here

- **Bursts are normal for LLM clients.** A chatbot page load or an agent step often fires a few calls at once. A bucket lets a key spend a burst it saved up while still holding the long-run average to the configured rate.
- **Two numbers per key.** Memory does not grow with traffic, unlike a sliding log.
- **Honest `Retry-After`.** The time until the next token is `(1 - tokens) / rate`, so clients back off for exactly as long as needed.
- **Rate and burst are separate knobs**, so an interactive key can have a large burst and a batch key a small one.

## Why it is atomic

Reading the bucket, computing the refill and writing it back happen in one Lua script (`TOKEN_BUCKET_LUA` in `gateway/src/limits/tokenBucket.ts`). Redis runs a script without interleaving other commands, so two concurrent requests can never both take the last token. A version that did `GET`, compute in Node, then `SET` would have exactly that race. The integration test fires 200 concurrent requests at a bucket of 20 and checks that exactly 20 succeed.

The time comes from the gateway (`now` is a script argument) so tests can drive the clock. With several gateway instances, their clocks should be NTP-synced; a skew of a few milliseconds only shifts refills by that much.

## If Redis is down

The limiter fails open to an in-memory bucket per gateway instance. Limits still apply, but each instance counts separately, so with N instances a key could get up to N times its rate until Redis is back. The alternative, failing closed, would turn a Redis outage into a full gateway outage, which is the wrong trade for an internal tool.

## Budgets

Monthly token budgets use a plain Redis counter per key per UTC month (`usage:<key>:<YYYY-MM>`), checked before the provider call and increased by the actual tokens after it. Concurrent requests can therefore overshoot a budget by what they use between check and record. Reserving `max_tokens` up front would prevent that but would reject requests that would have fit; for internal budgets the small overshoot is the better trade. If the counter is lost, it is rebuilt from the request log in Postgres.
