# Easy Race Timer

Modern, web-based timing software for Finnish sports organizations and competition organizers. The system supports multiple sports and offers three deployment options based on organizational needs.

## 🎯 Project Goals

- **Ease of use**: Intuitive interface for stressful competition situations
- **Flexibility**: Supports single time trials to events with thousands of participants
- **Reliability**: Comprehensive stopwatch backup system for technical failures
- **Accessibility**: Works on older Android/iOS devices and slow network connections
- **Language support**: Fully bilingual (Finnish/English) interface

## 🏁 Supported Sports and Competition Types

### Comprehensive sport support

- **Athletics**: Running, marathon, cross-country
- **Cycling**: Road, cyclocross, MTB
- **Triathlon**: Swimming-cycling-running combinations
- **Skiing**: Cross-country, sprints
- **Other sports**: Easy to add new sports

### Competition types

- **Mass starts**: Everyone starts at the same time
- **Individual start times**: Time trial type competitions
- **Multi-day events**: Competitions spanning several days
- **Relays**: Team competitions
- **Series competitions**: Multiple competition totals

## 🏗️ System Architecture

### Three deployment options

#### 1. Standalone (0 EUR/month)

- **Deployment**: Docker Compose on local machine
- **Database**: Local PostgreSQL
- **Suitable for**: Individual clubs, development, demo
- **Limitations**: No cloud features, manual maintenance

#### 2. Self-hosted Cloud (25-45 EUR/month)

- **Deployment**: VPS server + Docker Compose
- **Database**: Managed backups (automated)
- **Suitable for**: Clubs wanting cloud benefits while keeping data under own control
- **Features**: SSL certificates, automatic updates

#### 3. Managed Cloud (Kubernetes)

- **Deployment**: Fully managed Kubernetes environment
- **Database**: Cloud service managed database
- **Suitable for**: Large organizations, high availability requirements
- **Features**: 99.9% uptime, automatic scaling, 24/7 support

### Technology choices

- **Backend**: Node.js 18+ LTS, Express.js, TypeScript
- **Frontend**: React 18+, TypeScript, Tailwind CSS
- **Database**: PostgreSQL 14+ with Row-Level Security
- **Real-time**: Socket.io WebSocket connections
- **Authentication**: JWT-based token systems
- **Containerization**: Docker + Kubernetes

## 🚀 Development Status

### Planning Phase (Complete ✅)

- [x] System architecture defined
- [x] Technology choices made
- [x] Database design complete
- [x] API design complete
- [x] Multi-tenant architecture planned
- [x] Stopwatch backup system designed
- [x] Comprehensive technical documentation

### Upcoming Development Phases

#### Phase 1: Backend Core (v0.1)

- [ ] PostgreSQL database schema
- [ ] REST API foundations
- [ ] JWT authentication
- [ ] Multi-tenant data isolation
- [ ] WebSocket basics

#### Phase 2: Frontend Core (v0.2)

- [ ] React application foundation
- [ ] Component library (Tailwind + Shadcn/ui)
- [ ] Competition management UI
- [ ] Competitor registry UI
- [ ] Bilingual support (i18n)

#### Phase 3: Timing (v0.3)

- [ ] Digital timing interface
- [ ] Real-time result updates
- [ ] Time synchronization system
- [ ] Basic result calculation

#### Phase 4: Manual Timing (v0.4)

- [ ] Stopwatch registration
- [ ] Automatic time conversion
- [ ] Paper form generation
- [ ] Manual time import

#### Phase 5: Production Ready (v1.0)

- [ ] Docker container configuration
- [ ] Security audit
- [ ] Performance testing
- [ ] GDPR compliance verification
- [ ] User guide documentation

## 🔧 Technical Notes

### Reliability and Backup Systems

- **Stopwatch support**: Multiple stopwatches with different start times
- **Automatic conversion**: Stopwatch times automatically converted to race times
- **Offline operation**: Works without internet, syncs when connection returns
- **Paper forms**: Automatic backup form generation

### Performance and Scalability

- **Older devices**: Optimized for Android 7+/iOS 12+ devices
- **Low memory usage**: Works on 2GB RAM devices
- **Fast response**: Sub-second timing accuracy
- **Concurrent users**: Supports hundreds of simultaneous users

### Security and Privacy

- **GDPR compliance**: Full EU data protection regulation support
- **Multi-tenant isolation**: Organization data completely isolated
- **Encryption**: HTTPS/WSS encrypted connections
- **Backup**: Automatic, encrypted backups

## 🌐 Language Support

- **Finnish**: Primary language, full localization
- **English**: International use
- **Dynamic switching**: Language can be changed on the fly
- **API documentation**: English (international standard)

## 📄 Documentation

- **[Technical Architecture](TECHNICAL_ARCHITECTURE.md)**: Comprehensive technical design
- **[Finnish README](README.md)**: Suomenkielinen dokumentaatio
- **User guides**: Coming when implementation progresses
- **API documentation**: Coming with backend development

## 🚧 Current Status

**Development phase**: Planning complete, implementation starting

**Next steps**:

1. Backend PostgreSQL schema and API foundations
2. React frontend foundation and component library
3. First working MVP with timing features

**Participation**: Can join the project when first MVP is ready

---

**Updated:** August 9, 2025

**Documentation**: [Technical Architecture](TECHNICAL_ARCHITECTURE.md) | [Suomi](README.md)
**Policies**: [Security](SECURITY.md) | [Code of Conduct](CODE_OF_CONDUCT.md)

## 🚀 Development Phases

### Phase 1: Core System (v1.0)

- [x] Project structure and README
- [ ] Backend API (Node.js)
- [ ] Frontend basics (React)
- [ ] Bilingual support (FI/EN) - i18n implementation
- [ ] Simple button-based timing
- [ ] Competitor management
- [ ] Results display
- [ ] Docker container setup

### Phase 2: Modularity (v1.5)

- [ ] Role-based user management
- [ ] Browser-based client computer support
- [ ] Automatic view selection based on role
- [ ] Real-time WebSocket connections
- [ ] Role distribution across machines
- [ ] Communication system between client computers

### Phase 3: Cloud Service (v2.0)

- [ ] VPS deployment
- [ ] Internet connections
- [ ] User management and authentication
- [ ] Mobile browser support

### Phase 4: IoT and Automation (v3.0)

- [ ] Raspberry Pi integration
- [ ] Automatic sensors
- [ ] Split timing system
- [ ] Offline cache functionality

## 📁 Project Structure (Planned)

```text
Easy-Race-Timer/
├── backend/                 # Node.js API server
│   ├── src/
│   │   ├── controllers/     # Route handlers
│   │   ├── models/          # Database models
│   │   ├── services/        # Business logic
│   │   ├── utils/           # Utility functions
│   │   └── websocket/       # WebSocket handlers
│   ├── package.json
│   └── Dockerfile
├── frontend/                # React application (All roles)
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── Timer/       # Timing components
│   │   │   ├── Competitors/ # Competitor management
│   │   │   ├── Results/     # Results display
│   │   │   ├── Admin/       # Administration
│   │   │   ├── StartView/   # Start computer view
│   │   │   ├── FinishView/  # Finish computer view
│   │   │   └── DisplayView/ # Announcement computer view
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API calls
│   │   ├── auth/            # User management and roles
│   │   └── i18n/            # Internationalization (FI/EN)
│   ├── package.json
│   └── Dockerfile
├── raspberry-pi/            # IoT integration
│   └── (Future)
├── docker-compose.yml       # Full system orchestration
├── docs/                    # Documentation
├── README.md               # Finnish documentation
└── README_EN.md           # This file (English)
```

## 🎮 Use Cases

### Small Competition (1 computer)

1. Start Docker Compose
2. Open browser -> master computer serves all roles
3. Add competitors
4. Record times with button presses
5. Display results

### Large Competition (multiple computers)

1. **Master computer**: Login with admin role -> management view
2. **Start computer**: Login with start role -> start view opens automatically
3. **Finish computer**: Login with finish role -> finish view opens automatically
4. **Announcement computer**: Login with display role -> results display opens automatically
5. Everything synchronizes in real-time via WebSocket connections

**Note**: All client computers use the same React application with different views

## 👤 Role-Based User Interface

### User Roles

- **Admin**: Main user, all features available
- **Start**: Start time recording and competitor management
- **Finish**: Finish time recording
- **Display**: Results and information display for audience
- **Timer**: General timing role (start + finish)

### Automatic View Selection

1. **Login**: User enters credentials
2. **Role Recognition**: System identifies user's role
3. **View Routing**: Browser automatically navigates to the correct view
4. **Restricted Functions**: User sees only functions relevant to their role

### Flexibility

- **Admin users**: Can choose their preferred view
- **Role switching**: Possible to change role by re-logging in
- **Mobile support**: All views work on mobile devices as well

## 🔧 Development Principles

1. **Don't Reinvent the Wheel**: Use existing components and libraries
2. **Modularity**: Components isolated and reusable
3. **DRY Principle**: Minimize code repetition
4. **Progressive Enhancement**: Start simple, add features gradually
5. **Future-Proof**: Keep architecture open for future extensions

## 🌐 Language Support and Internationalization

### Built-in Languages

- **Finnish (FI)**: Primary language and development language
- **English (EN)**: International use, built-in

### Technical Implementation

- **React i18n**: Internationalization in React components
- **Backend i18n**: API messages and error texts in both languages
- **User Choice**: Language selectable from user interface
- **Dynamic Switching**: Language can be changed on the fly

### Future Language Extensions

- Community translations
- Additional languages as needed (Swedish, German, etc.)
- Translation tool integration

### Documentation Language Support

- **README**: Finnish (primary) + English (README_EN.md)
- **API Documentation**: English (international standard)
- **User Guides**: Both languages
- **Code Comments**: English (developer-friendly)

## 📝 Notes

- Database stays lightweight, but system must scale to larger competitions
- Speed is critical - no delays during timing
- Offline operation important (network interruptions must not affect timing)
- User interface must be intuitive even in stressful situations

## 🚧 Development Status

**Current Phase**: Project planning and basic structure creation

**Next Steps**:

1. Backend API skeleton
2. React frontend foundation
3. First working timing prototype

---

**Updated:** August 9, 2025 (synchronized with Finnish README)

## 📄 License

This project uses a custom "Free Use License for Sports Organizations".

Summary:

- ✅ Free use for sports clubs, federations, and event organizers
- ✅ Normal competition entry fees allowed
- ✅ Self-hosting and modifications allowed (must keep same license)
- ❌ Not allowed to sell as a hosted/commercial SaaS service
- ❌ No reselling or proprietary closed-source derivatives
- ➡️ For commercial hosting/support services contact: [valtteri@vehvilainen.cc](mailto:valtteri@vehvilainen.cc)

Full terms: see LICENSE file.

Related policies: [Security Policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Contributing](CONTRIBUTING.md)
