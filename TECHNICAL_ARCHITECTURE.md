# Technical Architecture Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [Technology Stack](#technology-stack)
4. [Database Design](#database-design)
5. [API Architecture](#api-architecture)
6. [Timing Systems](#timing-systems)
7. [Deployment Architecture](#deployment-architecture)
8. [Security & Multi-tenancy](#security--multi-tenancy)
9. [Data Management](#data-management)
10. [Development & Operations](#development--operations)
11. [Types & Interfaces](#types--interfaces)
12. [Competitive Advantages](#competitive-advantages)

---

## System Overview

Easy Race Timer is a modern, web-based timing system designed for Finnish sports organizations. The system supports three deployment modes:

- **Standalone**: Local Docker deployment for individual organizations
- **Self-hosted Cloud**: Cloud VPS deployment for organizations wanting cloud benefits
- **Managed Cloud**: Fully managed Kubernetes deployment for maximum scalability

### Key Features

- **Multi-sport Support**: Athletics, cycling, skiing, triathlon, and custom sports
- **Individual Start Times**: Support for time trials and rolling starts
- **Real-time Results**: Live WebSocket updates during competitions
- **Offline Capability**: Works without internet connection
- **Manual Timing Backup**: Comprehensive stopwatch backup system
- **GDPR Compliance**: Built-in privacy controls for EU organizations
- **Bilingual**: Finnish and English support

---

## Architecture Principles

### Multi-tenant Design

- Single codebase serves all deployment modes
- PostgreSQL Row-Level Security for data isolation
- Shared database, shared schema architecture
- Organization-scoped API requests

### Scalability Strategy

- Horizontal scaling via Kubernetes (managed cloud)
- WebSocket scaling with Redis clustering
- Database connection pooling
- CDN for static assets

### Reliability Requirements

- 99.9% uptime for managed cloud
- Automatic failover and recovery
- Comprehensive backup system
- Manual timing fallback procedures

---

## Technology Stack

### Backend

```typescript
{
  "runtime": "Node.js 18+ LTS",
  "framework": "Express.js with TypeScript",
  "database": "PostgreSQL 14+ with Row-Level Security",
  "realtime": "Socket.io for WebSocket connections",
  "authentication": "JWT with role-based access",
  "validation": "Zod for schema validation",
  "monitoring": "Prometheus + Grafana"
}
```

### Frontend

```typescript
{
  "framework": "React 18+ with TypeScript",
  "bundler": "Vite for fast development",
  "ui": "Tailwind CSS + Shadcn/ui components",
  "state": "Context API + React Query",
  "pwa": "Progressive Web App for mobile",
  "offline": "Service Worker for offline capability"
}
```

### Infrastructure

```yaml
deployment_modes:
  standalone:
    infrastructure: "Docker Compose"
    database: "PostgreSQL container"
    suitable_for: "Development, small organizations"
    
  self_hosted_cloud:
    infrastructure: "Docker Compose on VPS"
    database: "PostgreSQL container"
    features: "SSL, automatic backups"
    
  managed_cloud:
    infrastructure: "Kubernetes cluster"
    database: "Managed PostgreSQL (Cloud SQL/RDS)"
    features: "Auto-scaling, 99.9% SLA, monitoring"
```

---

## Database Design

### Core Schema

```sql
-- Organizations (multi-tenant root entity)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50) NOT NULL,
    subdomain VARCHAR(50) UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Competitors
CREATE TABLE competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    gender VARCHAR(10),
    email VARCHAR(255),
    phone VARCHAR(50),
    club VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Competitions
CREATE TABLE competitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    sport_type VARCHAR(50) NOT NULL,
    competition_date DATE NOT NULL,
    start_time TIME NOT NULL,
    location VARCHAR(255),
    status VARCHAR(20) DEFAULT 'upcoming',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Competition Categories
CREATE TABLE competition_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID NOT NULL REFERENCES competitions(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    min_age INTEGER,
    max_age INTEGER,
    gender VARCHAR(10),
    distance_km DECIMAL(8,3),
    start_time_offset INTEGER DEFAULT 0, -- seconds from main start
    individual_start_times BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Competition Entries
CREATE TABLE competition_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID NOT NULL REFERENCES competitions(id),
    competitor_id UUID NOT NULL REFERENCES competitors(id),
    category_id UUID NOT NULL REFERENCES competition_categories(id),
    bib_number INTEGER NOT NULL,
    individual_start_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'registered',
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(competition_id, bib_number),
    UNIQUE(competition_id, competitor_id)
);

-- Timing Events
CREATE TABLE timing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES competition_entries(id),
    timing_point VARCHAR(20) NOT NULL, -- 'start', 'finish', 'split_5k', etc.
    timestamp_ms BIGINT NOT NULL,
    operator_id UUID REFERENCES users(id),
    device_id VARCHAR(100),
    timing_method VARCHAR(20) DEFAULT 'digital', -- 'digital', 'manual', 'chip'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Row-Level Security

```sql
-- Enable RLS on all tenant tables
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timing_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (example for competitors)
CREATE POLICY competitors_isolation ON competitors
    USING (organization_id = current_setting('app.current_organization_id')::UUID);

CREATE POLICY competitors_insert ON competitors
    FOR INSERT WITH CHECK (organization_id = current_setting('app.current_organization_id')::UUID);
```

---

## API Architecture

### Multi-tenant Request Flow

```typescript
// Organization context middleware
export const extractOrganizationContext = (req: Request, res: Response, next: NextFunction) => {
  const deploymentMode = process.env.DEPLOYMENT_MODE || 'standalone';
  
  let organizationId: string;
  
  if (deploymentMode === 'standalone') {
    // Single organization mode
    organizationId = process.env.DEFAULT_ORGANIZATION_ID || 'local-org';
  } else {
    // Multi-tenant cloud modes
    // Extract from subdomain: uurainen.easyracetimer.fi
    const subdomain = req.headers.host?.split('.')[0];
    const organization = await getOrganizationBySubdomain(subdomain);
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    organizationId = organization.id;
  }
  
  // Set organization context for database queries
  await setOrganizationContext(organizationId);
  req.organizationId = organizationId;
  
  next();
};

// Database context setting
export const setOrganizationContext = async (organizationId: string) => {
  await db.query('SET app.current_organization_id = $1', [organizationId]);
};
```

### REST Endpoints

```typescript
// Competition Management
GET    /api/competitions                    // List competitions
POST   /api/competitions                    // Create competition
GET    /api/competitions/:id               // Get competition details
PUT    /api/competitions/:id               // Update competition
DELETE /api/competitions/:id               // Delete competition

// Competitor Management
GET    /api/competitors                     // List competitors
POST   /api/competitors                     // Add competitor
GET    /api/competitors/:id                // Get competitor details
PUT    /api/competitors/:id                // Update competitor

// Competition Entries
GET    /api/competitions/:id/entries       // List entries
POST   /api/competitions/:id/entries       // Register competitor
PUT    /api/entries/:id                    // Update entry
DELETE /api/entries/:id                    // Remove entry

// Timing
POST   /api/competitions/:id/timing        // Record timing event
GET    /api/competitions/:id/results       // Get results
GET    /api/competitions/:id/live-results  // Get live results

// Manual Timing
POST   /api/competitions/:id/manual-timing // Import stopwatch times
GET    /api/competitions/:id/stopwatches   // List registered stopwatches
POST   /api/competitions/:id/stopwatches   // Register new stopwatch
```

### WebSocket Events

```typescript
// Real-time updates
interface WebSocketEvents {
  // Join competition room
  'join-competition': { competitionId: string };
  
  // Timing events
  'timing-event': {
    entryId: string;
    timingPoint: string;
    timestamp: number;
    bibNumber: number;
  };
  
  // Result updates
  'result-update': {
    competitionId: string;
    results: Result[];
  };
  
  // System status
  'system-status': {
    connectedUsers: number;
    activeTimers: number;
  };
}
```

---

## Timing Systems

### Precision Timing System

```typescript
// High-precision timing with network compensation
export class TimeSynchronization {
  private serverTimeOffset: number = 0;
  private networkLatency: number = 0;
  
  async initializeTimeSync(): Promise<void> {
    // NTP-style synchronization
    const samples = await this.takeSamples(5);
    const filtered = this.filterOutliers(samples);
    
    this.serverTimeOffset = this.calculateAverage(filtered, 'offset');
    this.networkLatency = this.calculateAverage(filtered, 'latency');
  }
  
  getPrecisionTimestamp(): number {
    return Date.now() + this.serverTimeOffset;
  }
  
  private async takeSamples(count: number): Promise<TimeSample[]> {
    const samples: TimeSample[] = [];
    
    for (let i = 0; i < count; i++) {
      const t1 = performance.now();
      const response = await fetch('/api/time', { method: 'POST' });
      const t4 = performance.now();
      const serverTime = await response.json();
      
      const latency = (t4 - t1) / 2;
      const offset = serverTime.timestamp - (t1 + latency);
      
      samples.push({ offset, latency, timestamp: t1 });
      await this.sleep(200);
    }
    
    return samples;
  }
}
```

### Manual Timing System

```typescript
// Enhanced stopwatch system supporting multiple devices
export class StopwatchManager {
  private static registeredStopwatches: Map<string, RegisteredStopwatch> = new Map();
  
  // Register physical stopwatch with flexible start time
  static registerStopwatch(
    competitionId: string,
    timingPoint: 'start' | 'finish',
    operatorName: string,
    startTime: Date, // When stopwatch was actually started
    location?: string
  ): RegisteredStopwatch {
    const stopwatch: RegisteredStopwatch = {
      id: generateId(),
      competitionId,
      timingPoint,
      operatorName,
      startedAt: startTime, // Critical: actual stopwatch start time
      registeredAt: new Date(),
      location: location || '',
      stopwatchNumber: this.getNextStopwatchNumber(competitionId),
      entries: [],
      isActive: true
    };
    
    this.registeredStopwatches.set(stopwatch.id, stopwatch);
    return stopwatch;
  }
  
  // Convert stopwatch reading to race time
  static convertStopwatchTime(
    stopwatchReading: string, // "MM:SS" or "H:MM:SS" from physical stopwatch
    officialStartTime: Date,  // Race start time
    stopwatchStartTime: Date  // When this stopwatch was started
  ): Date {
    const [hours, minutes, seconds] = this.parseTimeString(stopwatchReading);
    const stopwatchMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
    
    // Calculate actual event time
    const actualEventTime = new Date(stopwatchStartTime.getTime() + stopwatchMs);
    
    // Validate timing
    const raceTimeMs = actualEventTime.getTime() - officialStartTime.getTime();
    if (raceTimeMs < 0) {
      throw new Error('Event occurred before race start - check stopwatch times');
    }
    
    return actualEventTime;
  }
  
  private static parseTimeString(timeStr: string): [number, number, number] {
    const parts = timeStr.split(':').map(Number);
    
    if (parts.length === 2) {
      return [0, parts[0], parts[1]]; // MM:SS
    } else if (parts.length === 3) {
      return [parts[0], parts[1], parts[2]]; // H:MM:SS
    } else {
      throw new Error('Invalid time format. Use MM:SS or H:MM:SS');
    }
  }
}
```

---

## Deployment Architecture

### Unified Development Pipeline

```yaml
# Single build pipeline for all deployment modes
name: Build and Deploy Easy Race Timer

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker images
        run: |
          docker build -t easyracetimer/backend:${{ github.sha }} ./backend
          docker build -t easyracetimer/frontend:${{ github.sha }} ./frontend
      
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          npm run test:unit
          npm run test:integration
          npm run test:e2e

  deploy-standalone:
    needs: [build, test]
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Update standalone deployment
        run: |
          # Update Docker Compose configuration
          # No infrastructure changes needed

  deploy-managed-cloud:
    needs: [build, test]
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/backend backend=easyracetimer/backend:${{ github.sha }}
          kubectl rollout status deployment/backend
```

### Feature Flag System

---

## Security & Multi-tenancy

### Threat Model Overview

- Primary risks: unauthorized data access across tenants, timing data manipulation, account takeover
- Attack surfaces: API endpoints, WebSocket channels, admin UI, deployment secrets, backups
- Mitigations: strict RLS, input validation (Zod), JWT signature verification, rate limiting, audit logging

### Authentication & Authorization

- JWT access tokens (15m) + refresh tokens (rotating, httpOnly, secure)
- Role-based access: admin, start, finish, display, timer, read-only
- Fine-grained permission map stored in code (constant) to keep auditability
- Optional future: per-competition scoped temporary tokens for volunteer devices

### Multi-tenancy Enforcement

- PostgreSQL Row-Level Security: mandatory policies on every tenant table
- Session context variable: app.current_organization_id set per request
- All write queries must include organization_id in WHERE/INSERT columns; migrations enforce NOT NULL + FK
- Periodic automated test that attempts cross-tenant access and expects 0 rows

### Data Privacy & GDPR

- PII minimization: only necessary competitor fields stored
- Anonymization workflow (see GDPRManager) logged to audit_log table
- Right to access: export function returns structured JSON + CSV bundle
- Right to erasure: anonymization retains statistical results without identity

### Transport & Storage Security

- HTTPS/WSS enforced (HSTS in managed/self-hosted modes)
- TLS certificates via Let's Encrypt (self-hosted) or managed certificates (cloud)
- At-rest encryption: managed cloud DB encryption; optional fs-level encryption for self-hosted backups

### Secrets Management

- Standalone: .env (developer responsibility)
- Self-hosted: docker secrets / .env mounted root-only
- Managed cloud: Kubernetes secrets + sealed secrets (encrypted in git)

### Rate Limiting & Abuse Protection

- Token bucket per IP + per organization for auth routes
- WebSocket connection cap per IP (configurable)
- Suspicious pattern detection (excess 4xx / invalid JWT) -> temporary IP backoff

### Audit Logging

- Critical events: login, token refresh, role change, data export, anonymization, manual timing adjustments
- Stored in append-only audit_log table (separate retention config)

### Manual Timing Integrity

- Every manual timing import records: operator, source stopwatch id, raw reading, computed official time, hash
- Hash = SHA256(stopwatchId + raw + officialTime + secret_salt) to detect tampering

### Future Enhancements

- Optional WebAuthn for admin accounts
- Hardware security module (HSM) signing for managed cloud JWT
- Encrypted local storage of offline queue

---

```typescript
// Runtime feature detection based on deployment mode
export class FeatureManager {
  static isEnabled(feature: string): boolean {
    const mode = process.env.DEPLOYMENT_MODE;
    
    switch (feature) {
      case 'multi-tenant':
        return mode !== 'standalone';
        
      case 'auto-scaling':
        return mode === 'managed-cloud';
        
      case 'advanced-monitoring':
        return mode === 'managed-cloud';
        
      case 'unlimited-competitions':
        return mode === 'standalone'; // Local = unlimited
        
      default:
        return true; // Core features always enabled
    }
  }
}
```

---

## Data Management

### GDPR Compliance

```typescript
// Personal data handling for EU organizations
export class GDPRManager {
  // Export personal data
  static async exportPersonalData(competitorId: string): Promise<PersonalDataExport> {
    return {
      personalInfo: await this.getPersonalInfo(competitorId),
      competitionHistory: await this.getCompetitionHistory(competitorId),
      results: await this.getResults(competitorId),
      consents: await this.getConsents(competitorId)
    };
  }
  
  // Anonymize competitor (right to be forgotten)
  static async anonymizeCompetitor(competitorId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Keep results but anonymize personal info
      await tx.query(`
        UPDATE competitors 
        SET first_name = 'Anonymized', 
            last_name = 'Competitor',
            email = NULL,
            phone = NULL,
            gdpr_anonymized_at = NOW()
        WHERE id = $1
      `, [competitorId]);
      
      // Mark competition entries as anonymized
      await tx.query(`
        UPDATE competition_entries 
        SET anonymized = true 
        WHERE competitor_id = $1
      `, [competitorId]);
    });
  }
}
```

### Backup Strategy

```typescript
// Deployment-specific backup strategies
export class BackupManager {
  static async createBackup(mode: DeploymentMode): Promise<BackupResult> {
    switch (mode) {
      case 'standalone':
        return this.backupSQLite();
        
      case 'self-hosted-cloud':
        return this.backupPostgreSQL();
        
      case 'managed-cloud':
        return this.verifyCloudBackups();
    }
  }
  
  private static async backupPostgreSQL(): Promise<BackupResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${timestamp}.sql`;
    
    // Create backup
    await exec(`pg_dump ${process.env.DATABASE_URL} > backups/${filename}`);
    
    // Compress
    await exec(`gzip backups/${filename}`);
    
    // Upload to cloud storage if configured
    if (process.env.BACKUP_CLOUD_STORAGE) {
      await this.uploadToCloudStorage(`backups/${filename}.gz`);
    }
    
    return {
      filename: `${filename}.gz`,
      timestamp: new Date(),
      verified: await this.verifyBackup(`backups/${filename}.gz`)
    };
  }
}
```

---

## Development & Operations

### Database Migrations

```typescript
// Versioned database migrations
export interface Migration {
  version: string;
  description: string;
  up: string[];
  down: string[];
  requiresDowntime: boolean;
}

export const MIGRATIONS: Migration[] = [
  {
    version: '1.0.0',
    description: 'Initial schema',
    up: [
      'CREATE TABLE organizations (...)',
      'CREATE TABLE competitors (...)',
      // ... other tables
    ],
    down: [
      'DROP TABLE IF EXISTS timing_events CASCADE;',
      'DROP TABLE IF EXISTS competition_entries CASCADE;',
      // ... reverse order
    ],
    requiresDowntime: false
  },
  
  {
    version: '1.1.0',
    description: 'Add individual start times',
    up: [
      'ALTER TABLE competition_entries ADD COLUMN individual_start_time TIMESTAMP;',
      'ALTER TABLE competition_categories ADD COLUMN individual_start_times BOOLEAN DEFAULT false;'
    ],
    down: [
      'ALTER TABLE competition_entries DROP COLUMN individual_start_time;',
      'ALTER TABLE competition_categories DROP COLUMN individual_start_times;'
    ],
    requiresDowntime: false
  }
];
```

### Testing Strategy

```typescript
// Comprehensive testing approach
export const testingStrategy = {
  unit: {
    framework: 'Jest + React Testing Library',
    coverage: 85, // minimum percentage
    focus: 'Business logic, utilities, components'
  },
  
  integration: {
    framework: 'Supertest + Test containers',
    database: 'Real PostgreSQL with test data',
    websockets: 'Socket.io test client'
  },
  
  e2e: {
    framework: 'Playwright',
    scenarios: [
      'Complete competition workflow',
      'Multi-user concurrent timing',
      'Offline mode and sync',
      'Manual timing import',
      'GDPR data export'
    ]
  },
  
  performance: {
    loadTesting: 'Artillery.js',
    scenarios: {
      normal: '10 users, 5 minutes',
      bigEvent: '50 users, 10 minutes',
      stress: '200 users, 2 minutes'
    }
  }
};
```

---

## Types & Interfaces

```typescript
// Core type definitions
export interface Organization {
  id: string;
  name: string;
  shortName: string;
  subdomain?: string;
  settings: OrganizationSettings;
  createdAt: Date;
}

export interface Competition {
  id: string;
  organizationId: string;
  name: string;
  sportType: string;
  competitionDate: Date;
  startTime: string;
  location: string;
  status: 'upcoming' | 'active' | 'finished' | 'cancelled';
  categories: CompetitionCategory[];
  settings: CompetitionSettings;
}

export interface RegisteredStopwatch {
  id: string;
  competitionId: string;
  timingPoint: 'start' | 'finish';
  operatorName: string;
  startedAt: Date; // When physical stopwatch was started
  registeredAt: Date; // When registered in system
  location: string;
  stopwatchNumber: number;
  entries: StopwatchEntry[];
  isActive: boolean;
}

export interface StopwatchEntry {
  id: string;
  stopwatchId: string;
  bibNumber: number;
  stopwatchReading: string; // "MM:SS" or "H:MM:SS"
  recordedAt: Date;
  notes?: string;
  verified: boolean;
}

export interface TimingEvent {
  id: string;
  entryId: string;
  timingPoint: string;
  timestampMs: number;
  operatorId?: string;
  deviceId: string;
  timingMethod: 'digital' | 'manual' | 'chip';
  metadata: TimingMetadata;
  createdAt: Date;
}
```

---

## Competitive Advantages

### For Resource-Constrained Organizations

1. **Low Hardware Requirements**
   - Works on Android 7+ and iOS 12+ devices
   - Optimized for 2GB RAM devices
   - Offline capability for unreliable connections

2. **Flexible Deployment Options**
   - Free standalone mode for local use
   - Affordable self-hosted cloud (€25-45/month)
   - Scalable managed cloud when needed

3. **Comprehensive Manual Backup**
   - Multiple stopwatch support with different start times
   - Automatic conversion from stopwatch readings to race times
   - Paper backup sheet generation

4. **Finnish Sports Integration**
   - Direct integration with Finnish sports federations
   - Suomisport calendar synchronization
   - Compliance with Finnish sports regulations

---

Last updated: August 9, 2025
