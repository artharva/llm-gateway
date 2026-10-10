# LLM Gateway

One API in front of Gemini, Groq and Ollama that makes LLM calls reliable, cheap, safe and observable: fallback with circuit breakers, per-key rate limits and token budgets, response caching, PII redaction and a live dashboard.

![Dashboard after the load tests](docs/dashboard.png)

Apps call `POST /v1/chat` with a gateway API key and a model alias such as `fast` or `smart`. The gateway picks a provider, retries and falls back when one is down or slow, stops runaway keys, serves repeated questions from Redis, masks emails, phone numbers and ID numbers before a prompt leaves the system, and logs every call with its tokens and cost.

| Problem                              | What the gateway does                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| A provider goes down or slows down   | Per-alias fallback chain, timeouts, retries with jittered backoff, and a circuit breaker per provider shared via Redis |
| Nobody knows who is spending what    | Every request logged to Postgres with tokens, latency and cost; dashboard by key and provider                          |
| A buggy script burns the budget      | Token-bucket rate limit and a monthly token budget per key; HTTP 429 past either                                       |
| Identical questions are paid for     | Redis response cache keyed on the normalised request; hits cost 0 tokens                                               |
| Personal data leaks to a third party | Emails, Indian mobile numbers, Aadhaar, PAN and card numbers masked before the cache or any provider sees them         |
| "The AI is slow" with no evidence    | p50/p95 latency, error and fallback rates on the dashboard, Prometheus metrics at `/metrics`                           |

## Run it

Needs Docker. Provider keys are optional: without them, use the `mock` alias, which talks to the bundled mock provider.

```bash
cp .env.example .env          # set ADMIN_TOKEN; add GEMINI_API_KEY / GROQ_API_KEY if you have them
docker compose up --build     # gateway :8080, dashboard :3000, mock provider :4000, Postgres, Redis
```

Open http://localhost:3000, sign in with your `ADMIN_TOKEN`, and create a key on the **Keys** tab (or run `docker compose exec gateway node dist/cli/create-key.js --name demo`). Then send a request to the `mock` model, which works without any provider keys:

```bash
curl -s localhost:8080/v1/chat \
  -H "Authorization: Bearer gw_..." -H "Content-Type: application/json" \
  -d '{"model":"mock","messages":[{"role":"user","content":"Explain a circuit breaker in one line"}]}'
```

```json
{
  "text": "Mock answer from primary to: ...",
  "usage": { "input_tokens": 10, "output_tokens": 17 },
  "provider": "mock-primary",
  "latency_ms": 215
}
```

`fast`, `smart` and `balanced` need `GROQ_API_KEY` or `GEMINI_API_KEY` in `.env` (run `docker compose up -d` again after adding them). Without keys they return `502 all_providers_failed`. On Windows PowerShell, use `Copy-Item .env.example .env` and `Invoke-RestMethod` instead of `cp` and `curl`, or run the commands above in Git Bash.

`docker compose --profile local up` also starts Ollama for the `local` alias (pull a model first: `docker compose exec ollama ollama pull llama3.2:1b`).

### Without Docker

Node 22, Postgres 16 and Redis 7 running locally:

```bash
npm ci
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/gateway REDIS_URL=redis://localhost:6379 ADMIN_TOKEN=change-me-admin-token
npm run dev --workspace mock-provider &        # :4000
npm run dev --workspace gateway &              # :8080, runs migrations on start
npm run dev --workspace dashboard              # :5173, proxies /admin to :8080
```

Tests: `npm test` (unit), and `npm run test:integration` with `DATABASE_URL` pointing at a throwaway database and `REDIS_URL` set (it drops and recreates the schema).

## API

`POST /v1/chat` with `Authorization: Bearer <key>`:

| Field         | Default | Notes                                                          |
| ------------- | ------- | -------------------------------------------------------------- |
| `model`       |         | An alias from `gateway/config/gateway.json`                    |
| `messages`    |         | `[{ role: system / user / assistant, content }]`               |
| `max_tokens`  | 512     | Up to 32,768                                                   |
| `temperature` | 0       | 0 keeps answers deterministic, which also makes them cacheable |

Response headers: `X-Request-Id`, `X-Cache` (`HIT`, `MISS` or `BYPASS`), `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Token-Budget-Remaining`, and `Server-Timing: provider;dur=N` (time spent waiting on the provider; the rest is the gateway). Send `X-Gateway-Cache: bypass` to skip the cache or `force` to cache a temperature > 0 answer.

| Status | `error.code`                         | Meaning                                                                 |
| ------ | ------------------------------------ | ----------------------------------------------------------------------- |
| 400    | `invalid_request`, `unknown_model`   | Bad body, or an alias that doesn't exist (the error lists valid ones)   |
| 401    | `missing_api_key`, `invalid_api_key` | No key, unknown key or revoked key                                      |
| 429    | `rate_limited`, `budget_exceeded`    | Over the key's rate or monthly tokens; `Retry-After` says when to retry |
| 502    | `all_providers_failed`               | Every provider in the chain failed                                      |
| 503    | `all_circuits_open`                  | Every provider's breaker is open; `Retry-After` is the cooldown         |
| 504    | `gateway_timeout`                    | No provider answered within the 30 s request deadline                   |

Also: `GET /health` (Postgres, Redis and each provider's breaker), `GET /metrics` (Prometheus), and `/admin/*` (keys and dashboard stats, behind `ADMIN_TOKEN`).

### Model aliases

| Alias      | Providers, in order          | Timeout per call |
| ---------- | ---------------------------- | ---------------- |
| `fast`     | Groq → Gemini → Ollama       | 5 s              |
| `smart`    | Gemini → Groq → Ollama       | 15 s             |
| `balanced` | Groq and Gemini, round-robin | 10 s             |
| `local`    | Ollama                       | 30 s             |
| `mock`     | mock-primary → mock-backup   | 2 s              |

Changing a provider or the order is a config change, not a code change. Providers without an API key are skipped at start-up.

## How a request flows

```mermaid
flowchart LR
    C[Client app] -->|POST /v1/chat| L[Request log<br/>+ metrics]
    L --> A[Auth<br/>hashed key, cached]
    A --> V[Validate<br/>zod]
    V --> R[Rate limit<br/>token bucket, Lua]
    R --> B[Budget<br/>monthly tokens]
    B --> P[PII redaction<br/>regex + checksums]
    P --> K{Cache<br/>Redis}
    K -->|HIT, 0 tokens| C
    K -->|MISS| RT[Router<br/>alias → chain]
    RT --> CB{Breaker<br/>open?}
    CB -->|closed| T[Timeout + retry]
    T --> G[Groq / Gemini /<br/>Ollama / Mock]
    CB -->|open: skip| RT
    T -->|failed: next provider| RT
    G --> RT
    RT -->|answer| C
    L -.->|batched insert| PG[(Postgres<br/>request_logs, api_keys)]
    R -.-> RD[(Redis<br/>buckets, budgets,<br/>breakers, cache)]
```

Every step is one Express middleware or one class with its own tests:

```
gateway/src/
  routes/       /v1/chat, /health, /metrics, /admin
  middleware/   auth, validate, limits, privacy, requestLog, errors
  providers/    Provider interface + Groq, Gemini, Ollama, Mock adapters, registry
  router/       alias -> chain, priority and round-robin strategies
  reliability/  timeout, retry, CircuitBreaker (Redis Lua or memory)
  limits/       token bucket (Lua), RateLimiter, BudgetTracker
  cache/        cache key, ResponseCache
  privacy/      patterns, Luhn and Verhoeff checks
  logging/      cost table, batched Postgres log writer
dashboard/      React + Recharts admin UI
mock-provider/  Express server with per-instance delay and failure rate, changed at runtime
load-tests/     k6 scenarios, results and the summary script
```

## Design decisions

**Token bucket for rate limits.** A bucket allows short bursts (an agent firing three calls at once) while holding the long-run rate, and needs only two numbers per key. Fixed windows let a client send double the limit across a window boundary; sliding logs are exact but store every timestamp. The check-and-take runs as one Lua script, so it is atomic across gateway instances: 200 concurrent requests against a burst of 20 let exactly 20 through. Details in [docs/rate-limiting.md](docs/rate-limiting.md).

**Breaker state in Redis, not memory.** With three gateway instances, in-memory breakers mean each instance has to discover an outage on its own and keeps sending traffic to a dead provider. In Redis, the first instance to see five failures opens the breaker for all of them. Transitions (closed → open → half-open → closed) are Lua scripts, and half-open lets exactly one trial request through, with a timeout so a lost trial cannot wedge the breaker.

**Fail open when Redis is down.** Rate limits, budgets and breakers fall back to per-instance memory and the cache becomes a miss. Limits get weaker for a while, but a Redis outage never takes down every app that calls the gateway. Failing closed would turn a cache outage into a full outage.

**No caching when temperature is above 0.** A caller asking for temperature 0.8 wants varied answers; returning the same cached text every time would silently break that. Temperature defaults to 0, so most traffic is cacheable, and `X-Gateway-Cache: force` opts in anyway. The key is a SHA-256 of the alias, every message, `max_tokens` and `temperature`, with a namespace you bump to invalidate everything.

**A cache hit bills 0 tokens.** The point of the cache is that repeated questions stop costing money, so hits do not count against the key's budget and report zero usage.

**Retry only what can succeed.** Timeouts, network errors, 429 and 5xx are retried (twice, exponential backoff with full jitter, honouring `Retry-After` when it is short). A 400 or a content block is not: the same request will fail the same way. Those also don't count against the provider's breaker, since they say nothing about its health.

**PII redaction before the cache and the provider.** The prompt is masked (`[EMAIL]`, `[PHONE]`, `[AADHAAR]`, `[PAN]`, `[CARD]`) before anything is stored or sent. Card numbers must pass Luhn and 12-digit numbers must pass Verhoeff (or follow the word Aadhaar/UID), so order IDs and timestamps are left alone. Raw prompts are never logged; `LOG_PROMPTS=true` stores the redacted version.

**The mock provider is a real HTTP service.** Load and failure tests run against a server whose delay and failure rate change at runtime through `/control`, so outages are reproducible and free. The `mock` alias is its own chain, kept out of `fast` and `smart` so test traffic never mixes with real providers.

**Patterns used:** Adapter (each provider maps its API to one `Provider` interface), Strategy (priority vs round-robin ordering), Factory (the provider registry builds adapters from config), Circuit Breaker, and Chain of Responsibility (the middleware pipeline).

## Load test results

Run with k6 against the mock provider (fixed 200 ms delay) so the numbers are repeatable. Each scenario is one script in [load-tests/](load-tests/); raw k6 output is in [load-tests/results/](load-tests/results/).

| Scenario                 | Setup                                             | Result                                                                                                                       |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Baseline                 | Mock 200 ms, every prompt unique, ramp to 200 VUs | **924 req/s** at 200 VUs; p50 214 ms, p95 239 ms; **gateway overhead p50 9 ms**, p95 30 ms; 0% errors                        |
| Baseline, pushed further | Same, ramp to 600 VUs                             | 1,528 req/s; p50 388 ms, p95 484 ms; overhead p50 151 ms (CPU-bound); 0% errors                                              |
| Cache benefit            | 100 VUs, 50% of prompts repeat                    | **50% hit rate**; p50 **1 ms on hits** vs 205 ms on misses                                                                   |
| Provider outage          | 100 VUs; primary fails 100% from 20 s to 55 s     | **0% client errors** during the outage; breaker opened 0.3 s after the failure, closed 5.8 s after recovery; p95 224 ms      |
| Slow provider            | 100 VUs; primary takes 10 s, alias timeout 2 s    | p50 207 ms, p95 223 ms, max 2.6 s; 0% errors; 100% served by the backup                                                      |
| Abuse                    | Key limited to 60/min (burst 10) sends 600/min    | 532 of 601 rejected with 429 (all of the excess: 69 allowed vs 70 by policy); a well-behaved key alongside: 0 of 121 limited |

What each shows:

- **Baseline:** at 200 users the gateway adds about 9 ms at the median on top of the provider (measured per request as total time minus the provider time in `Server-Timing`). 924 req/s is close to the 935 req/s that 200 users each waiting ~214 ms can send, so 200 VUs did not saturate the machine.
- **Pushed further:** at 600 VUs throughput rises to about 1,500 req/s and then the 2 vCPUs saturate. The added latency is CPU contention, since k6, the gateway, the mock provider, Postgres and Redis share the same two cores.
- **Cache:** hits skip the provider entirely, about 200x faster.
- **Outage:** fallback hides the outage from clients completely. Once the breaker opens, requests skip the dead provider instead of waiting for it to fail, so p95 stays at the backup's latency. Recovery time depends on where the 20 s cooldown is when the provider comes back: up to 20 s, 5.8 s in this run.
- **Slow provider:** only the first requests wait for the 2 s timeout (the max of 2.6 s); after five timeouts the breaker opens and everything goes straight to the backup.
- **Abuse:** the token bucket let through exactly its burst plus the refill, and the other key was unaffected.

Machine: Intel Core i7-12700H laptop, Ubuntu 22.04 VM with 2 vCPUs and 4 GB RAM, Node 22, k6 1.8. Everything (k6, gateway, mock provider, Postgres, Redis) on that one VM, so these numbers are a floor. To reproduce: `docker compose up -d`, then `ADMIN_TOKEN=... bash load-tests/run-all.sh` (needs [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/); on Windows, run it from Git Bash).

## What broke and how I fixed it

- **A green outage test that tested nothing.** The integration test that breaks the primary provider sends the same request many times. Once the cache landed, every request after the first was a cache hit and never reached the broken provider, so the test no longer exercised fallback at all. Reliability tests now send `X-Gateway-Cache: bypass`, and every load test except the cache scenario uses unique prompts.
- **19,000 warnings in a 40-second outage.** With the breaker open, every request logged "provider failed; trying next" at warn level, one line per request, burying the real failures. Skipping a provider because its breaker is open is now a debug line; the state changes (closed → open → half-open) stay at warn. The same outage now logs 5 lines.
- **A recovery time that was too good.** The first outage run reported the breaker closing 0.7 s after the provider recovered. The outage lasted exactly 40 s, two full 20 s cooldowns, so the half-open trial happened to land just after recovery. Moving recovery off the cooldown cycle gave 5.8 s, which is the honest typical case, and the README says the bound is the cooldown.
- **A baseline that measured k6, not the gateway.** About 920 req/s at 200 VUs looked like the ceiling, but it matched what 200 users waiting 214 ms each can send. Adding a 600 VU run found the real limit for this machine (about 1,500 req/s).
- **"Gateway overhead" had no clean measurement.** Subtracting the mock's nominal 200 ms from client latency mixed in timer drift under load. The gateway now reports the provider call time in `Server-Timing`, and k6 subtracts it per request.
- **A dashboard that disagreed with the gateway.** The budget meter showed a budget of 0 as "no limit", but the gateway treats 0 as "blocked" (`used >= 0`). The dashboard now shows it as fully used.

## Using it from AgentLoop

AgentLoop, my coding agent (a separate project), can send every model call through the gateway with its own key, so its usage shows on the dashboard under that key:

```bash
export LLM_GATEWAY_URL=http://localhost:8080 LLM_GATEWAY_KEY=gw_...   # key created on the Keys tab
agentloop run "fix the failing test in auth.py" --repo examples/buggy_repo --model gateway:smart
```

`gateway:smart` needs a Gemini or Groq key in the gateway's `.env`; `gateway:mock` works without one (the mock only echoes, so the agent won't fix anything, but the calls show on the dashboard).

The gateway API is text only, so AgentLoop's gateway client describes its tools in the system prompt and parses a JSON `{"tool_calls": [...]}` reply. It honours `Retry-After` on 429 and 503, and stops at once when the key's monthly budget is used up.

## Not built (future work)

Streaming responses, multi-region deployment, billing real money, and semantic (embedding-based) caching. Three gateway instances behind a load balancer already work, since all shared state is in Redis and Postgres; the dashboard would need per-instance health.

More: [docs/interview-notes.md](docs/interview-notes.md) has answers to common design questions about this project.
