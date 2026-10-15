# Security Policy

Easy-Race-Timer handles personal data of race participants, including minors.
We take security reports seriously and appreciate responsible disclosure.

## Supported versions

The project is pre-1.0. Only the following receive security fixes:

| Version | Security fixes |
|---|---|
| Latest `0.1.x` release | Yes |
| `main` branch | Yes |
| Older releases, `legacy-2025` tag | No |

Once 1.0 is released, this table will define a support period for each release line.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a vulnerability.**

1. **Preferred:** GitHub private vulnerability reporting: the repository's
   *Security* tab > *Report a vulnerability*, or directly
   <https://github.com/Vihvila92/Easy-Race-Timer/security/advisories/new>.
2. **Alternative:** email [valtteri@vehvilainen.cc](mailto:valtteri@vehvilainen.cc).

These two channels are the project's single point of contact for vulnerabilities.

Please include, when you can:

- a description of the issue and its impact (personal data exposure, result integrity, denial of service, ...)
- the affected version or commit
- steps to reproduce or a proof of concept
- a suggested fix (optional)

## Response times

| Step | Target |
|---|---|
| Acknowledgement | within 5 working days |
| Initial assessment and severity | within 10 working days |
| Fix for critical and high severity | within 30 days |
| Fix for medium and low severity | in a scheduled release |
| Public disclosure | coordinated with the reporter, 90 days after the report by default |

These are targets for a small volunteer-run project, not contractual guarantees.
We will keep you informed if a fix takes longer. We credit reporters in the
advisory unless they prefer to stay anonymous.

## Scope

In scope:

- The local server (Fastify API, WebSocket) and the SQLite database
- The web app (PWA) and its offline queue
- Sync between devices
- Authentication and authorization (PIN, tokens)
- Handling of personal data, including data of minors: consent, publication
  levels, anonymization and retention
- CSV import, results export and backups
- The CI/CD pipeline and release artifacts

Out of scope:

- Deployments configured against the documentation (for example exposing the
  server to the internet without TLS)
- Attacks that require an already compromised device
- Social engineering and physical attacks
- Third-party services

## Safe harbour

We will not pursue legal action against good-faith security research that follows
this policy. In return, please:

- only use your own data or test data, and do not access, keep or share other
  people's personal data; delete anything you obtained by accident
- do not degrade availability, and do not test against live races run by clubs
- give us reasonable time to fix the issue before disclosing it

## How we handle vulnerabilities

This process is designed to align with the EU Cyber Resilience Act
(Regulation (EU) 2024/2847).

1. **Coordinated vulnerability disclosure.** This document is our CVD policy.
2. **Triage.** We reproduce the report and rate severity with CVSS.
3. **Fix.** Sensitive fixes are prepared privately (GitHub Security Advisory
   private fork) and released as soon as possible.
4. **Advisory.** We publish a GitHub Security Advisory and request a CVE where
   appropriate.
5. **Release.** Security fixes are free of charge and, where possible, shipped
   as a separate patch release rather than bundled with new features.
6. **Notification.** Users are informed through the security advisory and the
   release notes.
7. **Regulatory reporting.** Once the CRA reporting obligations apply
   (from 11 September 2026 onward for manufacturers in scope), actively exploited
   vulnerabilities and severe incidents will be reported as the regulation requires.
   Personal data breaches are handled under GDPR Articles 33 and 34.

## Defaults

- The server binds to localhost. Opening it on a LAN is a later, explicit choice.
- SQLite uses WAL and `synchronous=FULL`.
- Admin actions require a reason and are stored in the correction log.
- Wrong PIN attempts are rate-limited.

## Software bill of materials

We plan to attach a CycloneDX SBOM to every release. Tagged releases with an
SBOM do not exist yet; this section will be updated when they do.
