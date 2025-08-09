# Contributing to Easy Race Timer

Thank you for your interest in the Easy Race Timer project! This project is designed for Finnish sports organizations and the international sports community.

## 🎯 Project Status

**Notice**: The project is still in the planning phase. The first working version (MVP) is not yet ready.

- ✅ **Documentation complete**: Architecture and plans ready
- 🚧 **Development starting**: Backend and frontend implementation starting soon
- 📅 **MVP target**: First working version Q4 2025

## 🤝 How You Can Contribute

### Now (Planning Phase)

1. **Documentation improvements**
   - Fix typos and grammar
   - Improve translations (Finnish ↔ English)
   - Suggest improvements to technical documentation

2. **Feedback**
   - Comment on technical architecture
   - Suggest new features
   - Share experiences from sports event timing

3. **Testing and validation**
   - Test docker-compose configurations when available
   - Validate UI/UX designs

### When MVP is Ready

1. **Code development**
   - Backend API (Node.js + TypeScript)
   - Frontend component development (React + TypeScript)
   - Writing tests

2. **User experience improvements**
   - UX/UI design
   - Usability testing
   - Mobile optimization

3. **Specialized expertise**
   - Kubernetes deployment
   - Security updates
   - Performance optimization

## 🧪 Planned Development Setup (Preview)

> This section will become executable once initial code is pushed; it documents target tooling so contributors can prepare.

Requirements (planned):

- Node.js 18+ LTS
- Docker + Docker Compose
- PostgreSQL 14+ (optional locally – Docker will provide)
- pnpm OR npm (decision finalized at first commit; default assumption: npm)

Planned steps:

```bash
# Install dependencies (placeholder – paths will exist after initial commit)
cd backend && npm install
cd ../frontend && npm install

# Start full stack (placeholder compose file)
docker compose up -d
```

> This section will become executable once initial code is pushed; it documents target tooling so contributors can prepare.

### Branching Model

- `main`: Always releasable; protected.
- `feature/<short-description>`: New features.
- `fix/<issue-id>`: Bug fixes.
- `docs/<topic>`: Documentation-only changes.
- Small typo fixes may go directly via a single PR (still through branch).

### Pull Request Checklist

Before requesting review ensure:

1. All markdown and code linters pass (will be defined in repo config).
2. New/changed logic covered by unit tests (where applicable).
3. No secrets or credentials committed.
4. Documentation updated (README / architecture / comments) if behavior changes.
5. Internationalization: user-visible Finnish + English text added to i18n resources (once they exist).
6. Follows license (no proprietary-only additions).

### Code Style & Tooling (Planned)

- TypeScript: strict mode enabled.
- Linting: ESLint (airbnb + custom) + Prettier formatting.
- Commit hooks: Husky + lint-staged (format & lint only changed files).
- Testing: Jest (backend), Vitest / RTL (frontend), Playwright (E2E).
- Conventional commits (see commit types) recommended for automated changelog.

### Performance Considerations

- Avoid N+1 queries (use joins / batching).
- Keep WebSocket payloads small (only changed fields).
- Defer heavy calculations off request path where possible.
- Measure critical timing operations (target <50ms server processing per timing event under load).

### Internationalization (i18n)

- All UI strings: use i18n keys, never hard-coded (except technical debug logs).
- Finnish (fi) & English (en) keys required for any new user-facing text.
- Avoid embedding variables in concatenated strings – use interpolation placeholders.

### Documentation Contributions

- Keep Finnish README as authoritative for high-level product narrative.
- Mirror structural changes into English README for parity.
- Architecture deep changes: update `TECHNICAL_ARCHITECTURE.md` AND summarize in PR description.

### License Alignment

By contributing, you agree your contribution is released under the repository license (Free Use License for Sports Organizations). Do not submit code you cannot license under these terms.

### Security Reporting

Please DO NOT open a public issue for potential vulnerabilities.

Instead email: security reports to [valtteri@vehvilainen.cc](mailto:valtteri@vehvilainen.cc) with:

- A clear description
- Steps to reproduce / proof-of-concept
- Impact assessment
- Suggested mitigation (if any)

We aim to acknowledge within 5 business days.

### Sensitive Data & Secrets

- Never commit real API keys, JWT secrets, DB credentials, or production URLs.
- Use `.env.example` (will be added later) to show required variables without real values.
- Rotate any secret suspected of exposure immediately.

### Testing Guidance (Pre-Code Phase)

Once code exists, minimal baseline coverage target: 85% for critical logic (timing conversion, RLS enforcement wrappers) – UI snapshot coverage is non-goal; focus on behavior.

### Large Features

For multi-step features (> ~300 LOC or schema changes):

1. Open design issue with proposal.
2. Get maintainer approval.
3. Implement in small PRs (schema, service, API, UI) rather than one massive PR.

### Translation Contributions

When adding new language keys, keep alphabetical order within each namespace for merge clarity.

---
Updated: August 9, 2025

## 📋 Development Principles

1. **Finnish community first**
   - Discussion in Finnish in GitHub Issues (for Finnish users)
   - Code comments in English (international standard)
   - Documentation bilingual (FI/EN)

2. **Sports organizations' needs first**
   - Solve real problems
   - Simplicity before theoretical perfection
   - Reliability is critical

3. **Open development**
   - All discussion public
   - Decisions documented
   - Development work visible

## 🔧 Technical Contribution

### Before Writing Code

1. **Read documentation**
   - [README.md](README.md) - Project overview (Finnish)
   - [README_EN.md](README_EN.md) - Project overview (English)
   - [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) - Technical architecture
   - [LICENSE](LICENSE) - License understanding

2. **Discuss first**
   - Open GitHub Issue before major changes
   - Ensure work is not duplicated
   - Agree on technical approach

### Development Setup (Coming)

```bash
# When development environment is ready:
git clone https://github.com/Vihvila92/Easy-Race-Timer.git
cd Easy-Race-Timer
# Setup instructions will be added when code is ready
```

## 📝 Contribution Process

1. **Fork** the project on GitHub
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to your branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Commit Message Format

```text
type(scope): short description

Longer description if needed.

- Bullet point of changes
- Another change
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Maintenance

## 🌐 Community

### Communication

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: General discussion
- **Pull Requests**: Code review

### Code of Conduct

1. **Be friendly and constructive**
2. **Respect different viewpoints**
3. **Focus on the issue, not the person**
4. **Help new contributors**

## 🏃‍♂️ Special Areas

### Sports Background Helps

If you have experience organizing sports events:

- **Timing process validation**
- **Use case scenario testing**
- **Official requirements verification**
- **Usability testing in stressful conditions**

### Technical Background

If you are a developer:

- **Backend**: Node.js, PostgreSQL, WebSockets
- **Frontend**: React, TypeScript, PWA
- **DevOps**: Docker, Kubernetes, CI/CD
- **Security**: GDPR, authentication, data protection

## 📞 Contact

- **Project owner**: Valtteri Vehviläinen
- **Commercial inquiries**: <valtteri@vehvilainen.cc>
- **Technical questions**: GitHub Issues

## 🔮 Future Vision

By contributing to this project, you're helping build:

- A solution tailored for Finnish sports organizations
- International open-source sports software
- Modern technology for traditional sports timing
- A community that shares knowledge and experiences

Welcome aboard! 🏁

---

Updated: August 8, 2025
