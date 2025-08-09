# Documentation

Refer to:

- Root `README.md` for product overview
- `TECHNICAL_ARCHITECTURE.md` for high-level design
- `backend/README.md` for backend dev & migration details
- `database/README.md` for schema & RLS policy info

## Structure

- `api/` (planned OpenAPI spec)
- `user-guide/` (planned step-by-step usage guides)
- `development/` (coding standards, contribution, style guides)

## Implemented Backend Features (Summary)

- Custom migration runner (checksums, drift detection)
- Multi-tenant RLS (read & write isolation)
- Auth: users, org membership, signup/login, JWT middleware
- Competitions, entries & competitors endpoints with validation & pagination
- Structured logging & request correlation
- CI (migrations + tests + CodeQL) & Dependabot

## Pending Documentation

- OpenAPI spec (auth, competitions, entries, competitors)
- Real-time timing event protocol
- Extended error code catalog (auth, conflicts)
