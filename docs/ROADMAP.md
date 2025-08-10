# Project Roadmap & Granular TODO

Status reference date: 2025-08-09

Ordering: Top to bottom = execution order (within each section). Each line is a unit suitable for a focused PR unless noted as a combined task.

---

## 0. Completed (Baseline)

- Repository + initial architecture docs
- Custom SQL migration runner (checksums, drift detection, advisory lock)
- Core schema + RLS policies (organizations, competitions, competitors, categories, entries, timing_events placeholder)
- Competitions create/list endpoints
- Entries create/list endpoints (pagination + conflict handling)
- Auth: users, org_users, signup, login, JWT middleware
- Competitors CRUD
- API test suites (competitions, entries, auth, competitors)
- Test stability (unique emails) + pool teardown
- Documentation English conversion & sync

---

## 1. Immediate Next (Before Merging Current Feature Branch)

1. ✅ OpenAPI spec skeleton (auth, competitions list/create, entries list/create, competitors CRUD, error schemas) `docs/api/openapi.yaml`.
2. ✅ GET /competitions/:id (detail) endpoint + test.
3. ✅ GET /competitors/:id endpoint + test.
4. ✅ Standardize list responses to `{ data: [...], pagination: { limit, offset, count } }` (competitions, entries, competitors) + update tests.
5. ✅ Negative tests: duplicate signup (409), bad login (401), missing x-org-id (400), validation error (422 competitor create missing last_name or birth_year invalid).
6. ✅ Enforce required `JWT_SECRET` at process start (throw if missing) + test.
7. ✅ Add token `exp` (15m) & algorithm HS256 explicitly; test presence of exp claim.
8. ✅ Update `docs/api/ERROR_CODES.md` (ensure USER_EXISTS, INVALID_CREDENTIALS, add UNAUTHORIZED, add RATE_LIMITED placeholder).
9. ✅ Update CHANGELOG (Unreleased) for new endpoints & pagination change.
10. ⏳ Refine OpenAPI with uniform response schemas (detail/data + pagination components) – in progress.
11. ⏳ Create PR: feat/auth-and-competitors (after item 10 complete).

---
 
## 2. Backend Core Hardening (Phase 1 Completion)

1. `migrate:check` script + CI workflow to fail on pending/drift/missing checksum.
2. ESLint + Prettier setup; add `npm run lint` + CI job.
3. Jest coverage collection, threshold (>=80%), coverage badge placeholder.
4. Deterministic seed script (one org, 3 competitors, 1 competition, sample entries) with fixed UUIDs.
5. GET /competitions/:id/entries (if separate from list) including pagination metadata.
6. DELETE /competitions/:id (decide soft vs hard) + test (optional if not yet needed).
7. Rate limiting stub middleware (in-memory) for `/auth/*` routes (configurable window & limit env vars).
8. Central error formatting helper (unify JSON shape) + refactor routes.
9. Enhanced /health?full=1 endpoint (uptime, migration status, git sha env optional).

---
 
## 3. Frontend Foundation (Can Start After Seed Script – #15)

1. Initialize frontend (React + Vite + TS) structure.
2. Decide type sharing strategy (OpenAPI → types generation script) & implement.
3. Auth client (signup/login), token storage (memory/localStorage) + refresh token TODO placeholder.
4. Basic pages: Login, Dashboard placeholder.
5. API client wrapper (central fetch, error.code mapping).
6. Competitions list UI (fetch + render) with pagination.
7. Competitors list + create form UI.

---
 
## 4. Timing & Real-Time Preparation

1. Add `timing_events` table migration (if placeholder not final) with needed columns (entry_id, timing_point, timestamp_ms, method).
2. Indexes on timing_events (entry_id, timing_point, timestamp_ms).
3. WebSocket server skeleton (/ws) with join competition room event.
4. POST /timing-events endpoint (validate & insert) + broadcast over WS.
5. Jest integration test: timing event insertion triggers WS message.
6. Result calculation stub (finish - start) service.
7. GET /competitions/:id/results endpoint (stub net time) + test.

---
 
## 5. Observability & Performance

1. Dev pretty logging toggle (LOG_PRETTY=1) via pino-pretty or manual formatter.
2. Metrics scaffold (in-memory counters) + /metrics placeholder (Prometheus format TODO comment).
3. Add slow query histogram structure (even if not exported yet).
4. Basic load test script (Artillery) for signup + list competitions (baseline doc results).

---
 
## 6. Security & Compliance

1. Password policy enhancement (optional regex; update tests & docs).
2. UNAUTHORIZED handling for future protected routes (middleware returning error.code UNAUTHORIZED).
3. Define role constants (admin,start,finish,display,timer) – not enforced yet.
4. Migration: audit_log table (id, user_id, type, metadata JSONB, created_at).
5. Log signup/login events into audit_log.
6. SECURITY.md update with auth token expiry & logging notes.

---
 
## 7. Results & Calculation Expansion

1. Constrain timing_point via enum or CHECK.
2. Service to compute & cache results (materialized view or denormalized table) – choose approach & document.
3. Background job (on insertion) to update cached result (initial naive synchronous path acceptable first).
4. GET /competitions/:id/results returns rank, net time, competitor info.

---
 
## 8. Frontend Results UI

1. Live results page subscribing to WS events.
2. Competitor search/filter UX (client side initially).
3. Incremental row updates on timing events (optimistic UI).

---
 
## 9. Docker & Deployment

1. Backend production Dockerfile (multi-stage build → slim runtime, non-root user).
2. Docker Compose stack (backend + postgres) with env example file.
3. Entrypoint script running migrations before start.
4. Deployment docs update referencing new image + usage.
5. Optional: add Makefile shortcuts (make up, make test, etc.).
6. GitHub Action: build & push image on main merge (tag + sha).

---
 
## 10. Release & Governance

1. Semantic version tagging workflow (auto bump via conventional commits or manual script).
2. Release notes generation from CHANGELOG.
3. Create v0.1.0 milestone & issue mapping.
4. CODEOWNERS file.
5. Issue templates (bug, feature) + updated PR template (remove delivered follow-ups).

---
 
## 11. Post v0.1 Enhancements

1. RBAC authorization middleware (role → permission map) & apply to endpoints.
2. Refresh token & rotation strategy (httpOnly secure cookie) + blacklist/rotation table.
3. Optional WebAuthn support for admin accounts.
4. Pagination total COUNT queries (optional performance tuning later).
5. Rate limit persistence (Redis) for production.
6. Prometheus metrics export (switch placeholder to real client).
7. OpenTelemetry tracing (HTTP + pg instrumentation).
8. Partition timing_events (time or competition based) if volume warrants.

---
 
## 12. Optional / Nice-To-Have (Defer Unless Bandwidth)

1. CLI export script (org data export JSON + CSV bundle).
2. Bulk competitor import (CSV) endpoint + validation.
3. Password reset / email notification stub (abstract mailer).
4. Backup storage abstraction (local → S3 compatible) + docs.
5. Frontend dark mode toggle.

---
 
## 13. Exit Criteria for v0.1.0

- Tasks 1–20, 21–27, 28–34, 35–38, 52–57, 58–60 completed.
- All tests green; coverage threshold met.
- OpenAPI spec published & referenced in README.
- Seed script works: `migrate:up` + `seed` → sample data → lists render.
- Docker Compose: `up` yields running API + successful list endpoints.

---
 
## Completed (CI & Testing Enhancements)

- Split unit vs integration test jobs (matrix across PostgreSQL 14, 15, 16)
- Added early migrations drift check job
- Added concurrency cancellation for faster feedback
- Added aggregated coverage & junit artifact publishing job
- Added coverage thresholds + summary in GitHub Actions
- Introduced ESLint with separate lint job
- OpenAPI diff + CHANGELOG enforcement
- Flaky test retry (1 attempt) with reporter
- Coverage badge generation (artifact)

## Upcoming (Testing/CI Next Steps)

- Merge junit reports into single consolidated view (optional)
- Automate coverage badge commit to docs (optional)

## Cross-Cutting Guidelines

- Each migration accompanied by tests where logic changes (RLS, constraints).
- Keep PRs under ~500 LOC diff excluding generated OpenAPI.
- Update CHANGELOG Unreleased section with each merged feature PR.
- Add tests first for new endpoints (happy path + 1 negative).

---
 
## Tracking

Consider converting each numbered item into GitHub Issues with label: roadmap-phase-x to visualize progress.

