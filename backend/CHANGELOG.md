# Changelog

All notable changes will be documented in this file (keep focused on backend scope).

## Unreleased

- (add new entries above this line)

## 0.0.1-alpha (2025-08-09)

### Added

- Custom SQL migration system with advisory lock, checksums, drift detection.
- Core schema tables (organizations, competitors, competitions, competition_categories, competition_entries, timing_events).
- RLS policies for read and write isolation across all tables (multi-tenant via GUC app.current_org_id).
- Insert/update/delete policies expanded to all tables.
- Performance indexes & data quality constraints (indexes + unique & check constraints).
- Application role provisioning migrations (0009 role + 0010 privilege grants) for CI parity.
- Structured logging middleware (request id, per-request logger, slow query logging in JS pool wrapper).
- Competitions API (create/list) with validation (zod) and tests.
- Entries API (create/list) including pagination, conflict handling, 404 semantics, validation.
- Org header enforcement middleware (requireOrgMiddleware).
- Integration RLS test (org isolation) and API test suites.
- Docker-based local Postgres workflow scripts (db:up/db:down).
- Dependabot configuration (npm backend/frontend & GitHub Actions).
- CodeQL security analysis workflow.

### Changed

- Added pagination support to competitions and entries listing endpoints.
- Refactored repeated org header checks into dedicated middleware.

### Fixed

- Migration syntax for role creation (dynamic DB grant) & missing table privileges causing permission errors in tests.
- Added duplicate entry conflict test.

