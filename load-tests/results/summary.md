| Scenario | Setup | Result |
| --- | --- | --- |
| Baseline | Mock 200 ms, no cache hits, ramp to 200 VUs | 924.2 req/s at 200 VUs; p50 214 ms, p95 239 ms; gateway overhead p50 9 ms, p95 30 ms; errors 0% |
| Baseline, pushed further | Mock 200 ms, no cache hits, ramp to 600 VUs | 1528.1 req/s at 600 VUs; p50 388 ms, p95 484 ms; gateway overhead p50 151 ms, p95 240 ms; errors 0% |
| Cache benefit | 100 VUs, 50% of prompts repeat | hit rate 50%; p50 on hits 1 ms vs 205 ms on misses |
| Provider outage | 100 VUs; primary fails 100% from 20 s to 55 s | client errors 0% during the outage (0% overall); breaker opened after 324 ms, closed 5806 ms after recovery; p95 224 ms during the outage |
| Slow provider | 100 VUs; primary takes 10 s, alias timeout 2 s | p50 207 ms, p95 223 ms, max 2597 ms; errors 0%; 100% served by the backup |
| Abuse | Key limited to 60/min (burst 10) sends 600/min | 532 of 601 rejected with 429 (100% of the excess; 69 allowed vs 70 by policy); well-behaved key: 0 429s in 121 requests |

Machine: Intel Core i7-12700H (2 vCPUs given to the VM), 2 CPUs, 3915 MB RAM, Ubuntu 22.04.5 LTS VM (6.8.0-138-generic) on a Windows laptop, k6 v1.8.1. Gateway, mock provider, Redis, Postgres and k6 all on the same machine.
