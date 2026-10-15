# Security Policy

## Supported versions

| Version | Security fixes |
|---|---|
| Latest minor release (0.x.y) | Yes |
| Previous minor release | Critical fixes for 12 months after the next release |
| `legacy-2025` tag | No |

This policy covers the open Easy Race Timer core in this repository. A future hosted service will publish its own contact point.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion.**

Use GitHub private vulnerability reporting: open the **Security** tab and choose **Report a vulnerability**, or go directly to <https://github.com/Vihvila92/Easy-Race-Timer/security/advisories/new>. The report stays private between you and the maintainers.

Include, when you can: a description, steps to reproduce, the impact (personal data exposure, result integrity, denial of service), the version or commit, and a suggested fix.

## Timeline

| Step | Target |
|---|---|
| Acknowledgement | 5 business days |
| Initial assessment and severity (CVSS) | 10 business days |
| Fix, critical or high | 30 days (goal 7) |
| Fix, other | Next release, at most 90 days |
| Public advisory (GitHub Security Advisory, CVE) | With the fixed release, agreed with the reporter |

Actively exploited vulnerabilities are reported under the EU Cyber Resilience Act (Regulation (EU) 2024/2847, Article 14) through the ENISA reporting platform.

## Scope

In scope:

- The local server (Fastify API, WebSocket) and the SQLite database
- The PWA user interface and its offline queue
- CSV and `.ertx` import and export, backups
- Authentication (PIN, device pairing), consent records and anonymization
- Finish-tap integrity (append-only events, idempotent ids, crash between taps)
- Release artifacts and the CI/CD pipeline

Out of scope:

- A self-hosted install configured against the instructions (for example exposed to the internet without TLS)
- A laptop that is already compromised, or a database file copied off the machine
- Paper and web copies of results published before anonymization
- Social engineering, physical attacks and third-party services

## Safe harbor

Good-faith security research that follows this policy is not considered unauthorized. Do not access other people's personal data, do not degrade availability, do not test against clubs' live races, and delete any data you obtained.

## Defaults

- The server binds to localhost. Opening it on a LAN is a later, explicit choice.
- SQLite uses WAL and `synchronous=FULL`.
- Admin actions require a reason and are stored in the correction log.
- Wrong PIN attempts are rate-limited.

## Software bill of materials

Releases will ship with a CycloneDX SBOM and a build provenance attestation. You will be able to verify a file with `gh attestation verify <file> --repo Vihvila92/Easy-Race-Timer`.

Last updated: 15 Oct 2026
