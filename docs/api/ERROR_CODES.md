# API Error Codes (Draft)

| Code | HTTP | Meaning | Notes |
|------|------|---------|-------|
| ORG_HEADER_REQUIRED | 400 | Missing x-org-id header | Sent by requireOrgMiddleware |
| VALIDATION_ERROR | 422 | Input validation failed | Includes Zod issues array |
| ENTRY_EXISTS | 409 | Duplicate competition entry | Unique constraint violation |
| NOT_FOUND | 404 | Resource not visible or missing | RLS may hide resources |

## Conventions

- `error.code` is stable for client logic.
- Additional details in `error.details` when present (e.g., validation issues).
- Future errors (auth, rate limiting) will be appended here.
