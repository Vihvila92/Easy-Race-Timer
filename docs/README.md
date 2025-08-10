# Documentation

Refer to:

- Root `README.md` for product overview
- `TECHNICAL_ARCHITECTURE.md` for high-level design
- `backend/README.md` for backend dev & migration details
- `database/README.md` for schema & RLS policy info

## Structure

`api/` - OpenAPI draft spec in `api/openapi.yaml`
`user-guide/` - (planned) step-by-step usage guides
`development/` - (planned) coding standards, contribution, style guides

## Implemented Backend Features (Summary)

- Custom migration runner (checksums, drift detection)
- Multi-tenant RLS (read & write isolation)
- Auth: users, org membership, signup/login, JWT middleware
- Competitions, entries & competitors endpoints with validation & pagination
- Structured logging & request correlation
- CI (migrations + tests + CodeQL) & Dependabot

## Pending Documentation

OpenAPI spec refinement (auth, competitions, entries, competitors)
Standard response schema documentation (list vs detail)
Real-time timing event protocol
Extended error code catalog (auth, conflicts)
