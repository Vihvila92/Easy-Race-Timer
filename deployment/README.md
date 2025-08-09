# Deployment

Deployment configurations (current: local dev Postgres; future: full stack environments).

## Current

- `docker-compose.dev.yml`: Starts Postgres 15 with initialization scripts creating application role & enabling RLS prerequisites.

## Planned

- Standalone: Single-node Docker Compose (API + DB + optional UI)
- Self-hosted Cloud: Hardened Compose + backups & monitoring exporters
- Managed Cloud: Kubernetes manifests (Helm chart) with horizontal scaling, secrets management, automated migrations Job

## Conventions

- Migrations run as part of CI and on startup Job in K8s
- Application uses non-superuser role (`ert_app`) with least privilege
- All connections force `search_path=public`

## Future Items

- Add Prometheus/Grafana stack
- Add TLS termination (Caddy/Traefik) examples
- Automated backup/restore scripts
