# Production browsing load check — 8 September 2026

## Outcome

The tested public browsing mix completed without HTTP or response-validation errors through 10 requests/second. The 20 requests/second attempt delivered 892 of 900 scheduled requests successfully, but the safety runner skipped eight slots and stopped. This is **not** a full pass at the requested 20 requests/second rate, a maximum-capacity measurement, or a complete marketplace stress test.

No production customer records were changed. No sign-in, OTP, email delivery, chat, reservation, upload, or administrative mutation was exercised. Listing-detail API requests were deliberately excluded because they increment view counts.

## Environment and method

- Target: `https://uni.rocks`, through the normal public HTTPS path.
- Application revision: `49a4eb64e57fcd4d3a4c493921ede3d236671610`; its CI workflow had completed successfully.
- Ramp window: 14:20:55–14:23:52 UTC / 19:50:55–19:53:52 IST.
- Recovery window: 14:25:07–14:25:36 UTC / 19:55:07–19:55:36 IST.
- Load generator: a bounded Node.js HTTP runner on the operator's machine, separate from the droplet. No automatic retries, cookies, cache busting, or challenge bypasses.
- App container limits: 384 MiB memory, 0.75 CPU. The host has approximately 1 GiB physical memory and runs several other applications.
- Live data: three listings returned by public browse. A separate read-only database check found two active approved listings and nine non-deleted listings in all states.
- Public request mix: listing browse with newest/popular/price ordering, keyword search, category filtering, a seller profile, monthly leaderboard, category API, marketplace HTML, browse HTML, category HTML, and the favicon. Health requests were included in preflight/recovery.
- JSON response shapes, HTML responses, and favicon signature were checked. This was not a browser rendering, JavaScript execution, or full photo-download test.

Safety limits were 20 scheduled requests/second, 10 in-flight requests, 1,800 total requests, a four-second request timeout, and no further ramp when a stage's p95 exceeded 1.5 seconds. The runner also stopped for failed health/restart checks, unavailable monitoring, low host memory, high container memory, sustained CPU/I/O pressure, security challenges/rate limits, or excess failed responses. Resource samples were taken roughly every 10–15 seconds and at stage boundaries.

## Request results

Durations are measured from the external client through receipt of the complete response body. p95 means 95% of completed requests took no longer than the stated time.

| Target rate | Scheduled duration | Sent / scheduled | Failed | p50 | p95 | p99 | Maximum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 request/s | 20 seconds | 20 / 20 | 0 | 221 ms | 492 ms | 1,058 ms | 1,058 ms |
| 3 requests/s | 30 seconds | 90 / 90 | 0 | 191 ms | 360 ms | 680 ms | 680 ms |
| 5 requests/s | 30 seconds | 150 / 150 | 0 | 178 ms | 343 ms | 649 ms | 867 ms |
| 10 requests/s | 30 seconds | 300 / 300 | 0 | 184 ms | 355 ms | 461 ms | 526 ms |
| 20 requests/s | 45 seconds | 892 / 900 | 0 | 192 ms | 418 ms | 776 ms | 1,362 ms |

Including preflight, **1,467 requests completed, all HTTP 200**, with aggregate p95 404 ms and p99 691 ms. The slowest endpoint by p95 was the seller-profile API at 656 ms across 124 requests.

The final stage skipped eight scheduled slots under the runner's combined pacing/concurrency guard. The runner did not record which of those two conditions caused each skip, so the cause cannot be assigned confidently to client scheduling versus in-flight saturation. It exited with its safety-stop status and did not increase load. Requests/second must not be interpreted as simultaneous users.

A separate recovery check sent **30 requests at up to one request/second**, all HTTP 200: p50 175 ms, p95 281 ms, maximum 286 ms. The ramp's planned automatic cooldown was skipped by its safety stop; this separate recovery check replaced it.

## Independent production checks

- Caddy access logs matched all 1,467 run-tagged requests, all HTTP 200. Proxy-observed p95 was 275 ms; it excludes the full external-client network timing.
- Application log summary contained zero error-level records during the inspected test window.
- Container remained healthy, with zero restarts and no out-of-memory kill.
- Highest sampled container CPU: 29.81% of one CPU. Highest sampled Docker-reported memory: 129.8 MiB of 384 MiB. Post-ramp Docker-reported memory was 33.03 MiB. These are sampled values, not a continuous peak or a memory-leak assessment.
- Lowest sampled host available memory during the ramp: 134.1 MiB.
- The shared host already used approximately 1,023 MiB of swap before the test; it remained around that level. One ramp sample showed 47% I/O wait. Swapping and I/O wait were also observed during the initial preflight, before sustained load.
- Read-only database snapshots showed no waiting locks. The post-ramp snapshot had one active connection (the diagnostic query) and nine idle connections; this is not a measurement of peak pool usage.
- Protected operations checks reported a healthy database, zero pending/failed email jobs, and no OTP/email-delivery events during the process lifetime observed.
- Disk remained 65% used, with approximately 8.2 GiB available. The current Caddy access-log file was 5.6 MiB after the test; existing rotation configuration was unchanged.

## Release interpretation and remaining checks

This is encouraging evidence for the current, small public browsing workload. It does not establish capacity for a large marketing spike or for heavier authenticated actions.

Before claiming full stress-test coverage:

1. Exercise authenticated browsing, concurrent uploads/image processing, Socket.IO chat, reservation races, and exchange completion against isolated test data and non-delivering OTP/email providers.
2. Use a realistically larger dataset and production-like database/storage configuration. Three public listings do not expose large-table query costs.
3. Run sustained-load and recovery tests for at least 30 minutes in an isolated, production-like environment. This short check cannot rule out memory leaks or long-running resource exhaustion.
4. Separate pacing-delay and concurrency-limit counters in the test runner before retesting the 20 requests/second target.
5. Investigate the shared droplet's existing swap/I/O pressure before a large campaign. This test does not identify which co-hosted process causes it; no other application was stopped or reconfigured.

Local diagnostic artifacts and the bounded runner were saved in `/tmp/uni-market-prod-load.jt98ax/` (`report.json`, `logs-summary.json`, `recovery.json`, and scripts). They contain metrics and public endpoint paths, not response bodies, credentials, cookies, or signed image URLs. Temporary artifacts are not a durable archive; this document preserves the findings.
