# API Error Codes (Draft)

| Code | HTTP | Meaning | Notes |
|------|------|---------|-------|
| ORG_HEADER_REQUIRED | 400 | Missing x-org-id header | Sent by requireOrgMiddleware |
| VALIDATION_ERROR | 422 | Input validation failed | Includes Zod issues array |
| ENTRY_EXISTS | 409 | Duplicate competition entry | Unique constraint violation |
| USER_EXISTS | 409 | Email already registered | Signup duplicate email |
| INVALID_CREDENTIALS | 401 | Bad email or password | Login failure (no distinction) |
| NOT_FOUND | 404 | Resource not visible or missing | RLS may hide resources |
| UNAUTHORIZED | 401 | Missing / invalid auth token | Returned by protected future routes |
| RATE_LIMITED | 429 | Too many requests | Placeholder (rate limiting not yet implemented) |

## Conventions

- `error.code` is stable for client logic.
- Additional details in `error.details` when present (e.g., validation issues).
- Future errors (auth, rate limiting) will be appended here.
- Standard list responses return `{ data, pagination }` while detail returns `{ data }`.
