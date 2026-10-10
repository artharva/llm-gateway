# Interview notes

Short answers to the questions this project tends to raise, with pointers into the code.

## Resume bullets

- Built an LLM gateway in Node.js/TypeScript that routes requests across 3 AI providers (Gemini, Groq, Ollama) through a common adapter interface, with retries, per-provider circuit breakers in Redis and automatic fallback.
- Implemented atomic Redis token-bucket rate limiting (Lua) and monthly token budgets per API key; sustained 924 requests/sec at p95 239 ms with 9 ms median gateway overhead in k6 load tests, and 0% client errors during a simulated provider outage.
- Added response caching (50% hit rate on repeat traffic, 1 ms vs 205 ms median), PII redaction with Luhn/Verhoeff checks before prompts leave the system, and a React dashboard for latency, errors and cost per key.

## 1. Walk me through one request

`POST /v1/chat` goes through one Express middleware per step ([routes/chat.ts](../gateway/src/routes/chat.ts)):

1. **Log** starts a timer and registers an on-finish hook that writes one row to `request_logs` (batched) and updates Prometheus metrics.
2. **Auth** hashes the bearer key with SHA-256 and looks it up (cached for 30 s; an admin change clears the cache on that instance at once, and other instances within the TTL).
3. **Validate** checks the body with zod and fills defaults (`max_tokens` 512, `temperature` 0).
4. **Rate limit** takes one token from the key's bucket in Redis (Lua, atomic). Empty bucket: 429 with `Retry-After`.
5. **Budget** compares this month's token counter with the key's budget. Used up: 429 until the 1st of next month.
6. **PII redaction** masks emails, phones, Aadhaar, PAN and card numbers in every message.
7. **Cache** hashes the normalised request; a hit returns at once with 0 tokens billed.
8. **Router** turns the alias into a provider list. For each provider: skip it if its breaker is open, otherwise call it with a timeout and up to two retries; on failure, move to the next provider.
9. The answer is cached, the tokens are added to the budget counter, and the response goes back in one format whatever the provider.

## 2. Token bucket vs sliding window; why is the limiter atomic?

A token bucket holds up to `burst` tokens and refills at `rate_per_min / 60` per second. It allows short bursts and enforces the long-run rate with two numbers per key (tokens, last refill time). A fixed window lets a client send 2x the limit across a window boundary; a sliding log is exact but stores every request timestamp; a sliding-window counter approximates it with two counters. See [rate-limiting.md](rate-limiting.md).

It is atomic because read-refill-take-write runs as one Lua script inside Redis ([limits/tokenBucket.ts](../gateway/src/limits/tokenBucket.ts)), so two gateway instances can never both take the last token. A test fires 200 concurrent requests at a burst of 20 and exactly 20 succeed.

## 3. Circuit breaker states; why Redis?

- **Closed:** calls go through; failures within a 30 s window are counted.
- **Open:** after 5 failures, calls are skipped at once for a 20 s cooldown.
- **Half-open:** after the cooldown one trial call is allowed. Success closes the breaker; failure reopens it. A trial that never reports back expires after 30 s so the breaker cannot get stuck.

In Redis, all instances share one view of a provider: the first instance to see five failures protects the others. Each transition is a Lua script so two instances cannot both claim the half-open trial. The same state-machine tests run against the Redis store and the in-memory store ([reliability/CircuitBreaker.ts](../gateway/src/reliability/CircuitBreaker.ts)). In the outage load test the breaker opened 0.3 s after the provider started failing.

## 4. When should you not retry?

When the same request will fail the same way: 400 (bad request), 401/403, content-policy blocks. Also when the provider's `Retry-After` is longer than we are willing to wait (better to fall back now), when the request deadline has passed, and when the breaker opened between attempts. Retries use exponential backoff with full jitter so many clients that failed together do not retry in lockstep. Non-idempotent operations should not be retried blindly either; chat completions are safe to repeat.

## 5. What goes into the cache key? When is caching wrong?

SHA-256 of alias, every message's role and trimmed content, `max_tokens` and `temperature`, under a namespace (`cache:v1:`) that is bumped to invalidate everything. Caching is wrong when the caller asks for variety (temperature > 0), when the answer depends on time or on data outside the prompt, or when keys must not see each other's answers (set `scope: "key"`). Redaction runs before the cache, so cached entries never contain raw PII.

## 6. What if Redis goes down?

The gateway fails open ([redis/failover.ts](../gateway/src/redis/failover.ts)): rate limits, budgets and breakers fall back to per-instance memory, and the cache becomes a miss. Limits are weaker for a while (each instance enforces its own share), but apps keep working. Failing closed would turn a Redis outage into an outage of every app behind the gateway. Budget counters lost with Redis are rebuilt from `request_logs`.

## 7. Scaling to 3 instances behind a load balancer

It already works: the gateway keeps no state of its own. Rate limits, budgets, breakers and the cache live in Redis; keys and logs in Postgres. Put the instances behind any HTTP load balancer with `/health` as the health check. Next steps would be a Redis replica with Sentinel, a connection pooler (PgBouncer) for Postgres, and moving log writes to a queue if Postgres becomes the bottleneck.

## 8. A normal number flagged as Aadhaar

Patterns alone over-match (any 12-digit number looks like Aadhaar). So matches must pass a checksum: Verhoeff for Aadhaar, Luhn for cards. A random 12-digit order ID passes Verhoeff only 1 time in 10, and a 12-digit number is still masked when the text just before it mentions Aadhaar or UID. Each pattern has false-positive tests, such as order IDs and 13-digit timestamps. The trade-off is deliberate: a few masked order IDs are better than leaking an ID number.

## 9. Design patterns

- **Adapter:** each provider maps its own API to the `Provider` interface ([providers/](../gateway/src/providers/)).
- **Factory:** the registry builds adapters from config and skips ones without keys.
- **Strategy:** priority vs round-robin ordering of an alias's chain ([router/strategies.ts](../gateway/src/router/strategies.ts)).
- **Circuit Breaker** and **Retry with backoff** ([reliability/](../gateway/src/reliability/)).
- **Chain of Responsibility:** the middleware pipeline.
