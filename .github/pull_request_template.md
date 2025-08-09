# Summary

<!-- High-level summary of the change -->

## Changes

- Backend version: 0.0.1-alpha pre-release
- Custom SQL migration system (locking, checksums, drift detection)
- Schema tables: organizations, competitors, competitions, competition_categories, competition_entries, timing_events
- RLS policies (multi-tenant via GUC app.current_org_id) for read & write isolation
- Application role provisioning migrations (0009 role + 0010 privilege grants)
- Structured logging (request id, per-request child logger, slow query & error logging)
- Competitions API (create/list) with pagination & validation (zod)
- Entries API (create/list) with pagination, 404 semantics, duplicate conflict handling
- Shared org header enforcement middleware
- Integration & API test suites (RLS isolation, competitions, entries)
- Dependabot config (npm backend/frontend & GitHub Actions)
- CodeQL security analysis workflow
- OpenAPI draft spec & error code catalog
- Documentation overhaul (backend, database, deployment, docs index) + CHANGELOG

## Motivation

Establish a secure, testable foundation (multi-tenant RLS + initial endpoints) with automated dependency and security scanning ahead of iterative feature growth.

## Testing

- Jest tests pass locally (unit + integration)
- Migrations apply cleanly in CI environment
- RLS enforced: cross-org data isolation verified
- Duplicate entry conflict test passes (409)

## Security / Compliance

- Least-privilege role `ert_app` with explicit grants
- CodeQL workflow added (JavaScript)
- Dependabot for supply chain updates
- Error responses standardized with codes

## Migration Notes

Run migrations normally; new role & grants created (safe re-run). No destructive changes.

## Follow-ups (Not in this PR)

- Auth/JWT & user identity
- Competitors CRUD endpoints
- Timing events ingestion & websocket updates
- Metrics/tracing (OpenTelemetry)
- OpenAPI spec expansion & validation workflow
- PR status badges for coverage (once coverage added)

## Checklist

- [ ] CI green (tests + migrations)
- [ ] CodeQL analysis successful
- [ ] CHANGELOG updated (0.0.1-alpha section)
- [ ] Docs updated for any review feedback
- [ ] At least one approving review

## Screenshots / Logs (optional)

<!-- Insert any helpful output or screenshots here -->
