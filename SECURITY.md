# Security Policy

## Supported Status

At this early stage (pre-MVP) security updates are handled ad-hoc. As releases are tagged, a support window policy will be added (e.g., last 2 minor versions).

## Reporting a Vulnerability

Please email: [valtteri@vehvilainen.cc](mailto:valtteri@vehvilainen.cc)

Provide (if possible):

1. A clear description of the issue
2. Steps to reproduce / proof-of-concept
3. Impact assessment (data exposure, privilege escalation, integrity risk, DoS, etc.)
4. Suggested remediation (optional)

We aim to acknowledge within 5 business days.

DO NOT open public GitHub issues for vulnerabilities.

## Scope

In scope:

- Backend API (authentication, authorization, multi-tenant isolation)
- WebSocket real-time channels
- Manual timing import integrity
- Data export / anonymization workflows

Out of scope (for now):

- Third-party services (cloud provider managed layers)
- Local environment misconfiguration

## Handling Process

1. Receive & triage report
2. Reproduce and classify severity (LOW / MEDIUM / HIGH / CRITICAL)
3. Develop fix in private branch if sensitive
4. Release patch & security advisory (once public repo has code)
5. Credit reporter (optional on request)

## Design Principles

- Defense in depth (RLS, app-layer auth, input validation)
- Principle of least privilege (scoped roles, minimal tokens)
- Secure by default (HTTPS/WSS, no default admin credentials)
- Auditability (timing imports + admin actions logged)

Last updated: 9 Aug 2025
