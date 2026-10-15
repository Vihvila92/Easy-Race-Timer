# Security Policy

## Supported status

v0.1 is a local race-day app. Security fixes are handled as they are reported. A support window for tagged releases will be added when releases exist.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go directly to <https://github.com/Vihvila92/Easy-Race-Timer/security/advisories/new>. The report stays private between you and the maintainers.

Do not report vulnerabilities in public issues, pull requests or discussions.

Include, when you can:

1. A clear description
2. Steps to reproduce
3. Impact (data exposure, integrity, denial of service)
4. A suggested fix (optional)

We aim to acknowledge a report within 5 business days and to agree on a disclosure date with you. We publish fixes as GitHub Security Advisories.

## Scope

In scope:

- The local Fastify API and the SQLite database on the race laptop
- Finish-tap integrity (append-only events, idempotent ids, crash between taps)
- CSV import, results export and the anonymization job
- The PIN gate and the WebSocket channel on localhost

Out of scope for v0.1:

- Multi-tenant isolation and hosted SaaS (not in this version)
- Third-party cloud services
- A laptop that is already compromised, or a database file copied off the machine
- Paper and web copies of results published before anonymization

## Handling

1. Triage the report
2. Reproduce and rate severity (LOW / MEDIUM / HIGH / CRITICAL)
3. Fix on a private branch when the report is sensitive
4. Ship the patch and credit the reporter if they want credit

## Defaults

- The server binds to localhost. Opening it on a LAN is a later, explicit choice.
- SQLite uses WAL and `synchronous=FULL`.
- Admin actions require a reason and are stored in the correction log.
- Wrong PIN attempts are rate-limited.

Last updated: 15 Oct 2026
