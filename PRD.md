# Product Requirement Documents (PRD.md)

## 1. Introduction
Trip Angkutan is a mobile transportation application for Indonesian public transportation services, designed for field officers (petugas) to manage trips and vehicles. The system includes a mobile app (Ionic + React) and an admin dashboard (CodeIgniter 2.2.4 + React static build).

## 2. Core Requirements

### 2.1 Authentication & Authorization
- **Roles**: `officer` (petugas) and `admin` (supervisor)
- **Auth Flow**:
  - Officers: Login via username/password OR PIN (6-digit) → JWT token with 24h expiry
  - Admins: Login via username/password → JWT token with 24h expiry
  - Token storage: localStorage (trip.auth.token.v1) + API Authorization header
  - Refresh flow: POST /api/auth/refresh (token reborn from DB claims, no PIN)

### 2.2 Trip Creation Workflow
- **Status Selection**: "Kosong" (no vehicle) or "Ada Angkutan" (with vehicle)
- **Route Constraints**:
  - Kosong: Only SJRE → SBDZ route allowed (locked)
  - Ada Angkutan: All routes free
- **Auto-generated Trip ID**: TRP-YYYY-NNNN format
- **Vehicle Input**: 2-step process
  - Step 1: Input plate number, select vehicle type, category
  - Step 2: Detail information + mandatory camera photo (no gallery access)
- **Submit**: Locked until photo is captured

### 2.3 Vehicle Management
- **Plate Registration**: CRUD via POST /api/plates
- **Plate Status**: 
  - `internal`: Free (no tariff)
  - `lokal`: Free (configurable cadangan)
  - `eksternal`: Tariff based on region
- **OCR**: Camera capture → OCR → plate validation → status assignment

### 2.4 Sync & Offline Support
- **Local-First Architecture**: Data stored in localStorage
- **Sync Queue**: `src/services/sync.ts` manages pending trips
- **Auto-sync**: Network change or periodic intervals
- **Retry Logic**: Max 3 attempts with exponential backoff
- **Conflict Resolution**: Server wins; local changes may be overwritten

### 2.5 Admin Dashboard Features
- **CRUD Operations**: 
  - Tariffs (master + region-specific)
  - Officers (many-to-many regions)
  - Plates (registration + status)
  - Reports (trip details + vehicle details)
- **Reporting**: 
  - Expandable trip details with vehicle breakdown
  - Excel export (.xlsx) with 2 sheets: trip summary + vehicle details
  - Filtering by golongan & vehicle type
- **Settings**: 
  - Theme (Terang/Gelap)
  - Font size (90-125%)
  - Accent colors (Biru/Hijau/Ungu/Kuning)
  - Reset to default
  - Persistence via localStorage

### 2.6 Error Handling & Recovery
- **401 Unauthorized**: Session expired or non-active account → re-login required
- **403 Forbidden**: Token invalid or insufficient role
- **404 Not Found**: Invalid endpoint or missing resource
- **Network Errors**: Auto-retry with exponential backoff
- **OCR Failures**: Manual input fallback required

## 3. Functional Requirements (FR)

### FR-001: Authentication
- Login: username/password → POST /api/auth/member-login → JWT
- PIN Login: POST /api/auth/login → JWT (requires active account)
- Refresh: POST /api/auth/refresh → new JWT from DB claims
- Fallback: Demo PIN (123456) only when backend unreachable

### FR-002: Trip Creation
- Status selection: Kosong or Ada Angkutan
- Route selection: 
  - Kosong: locked to SJRE → SBDZ
  - Ada Angkutan: all routes available
- Vehicle input: 2 steps (plate → detail)
- Submit: requires camera photo → locked until photo captured

### FR-003: Vehicle Input
- 2-step process:
  - Step 1: Plate input + vehicle type selection
  - Step 2: Detail information + mandatory camera photo
- Detail view: Show previous plate info when clicked
- Photo requirement: Must be captured via camera, not gallery

### FR-004: Submit Trip
- Submit button disabled until:
  - At least 1 vehicle added
  - Camera photo captured
- Auto-sync after submission (POST /api/trips)

### FR-005: Offline Support
- Local storage for trip drafts and vehicle data
- Sync queue for background processing
- Auto-retry on network recovery

### FR-006: Officer Management
- CRUD operations for officers
- Many-to-many relationship with regions
- Status control: Aktif/Nonaktif
- Region access: admin-only assignment

### FR-007: Admin Dashboard
- CRUD for tariffs, plates, officers
- Report generation with detailed vehicle breakdown
- Excel export with 2 sheets (trip summary + vehicle details)
- Filtering by category and vehicle type

## 4. Non-Functional Requirements
- **Performance**: API responses < 500ms for 95% of requests
- **Reliability**: 99.9% uptime for backend services
- **Security**: JWT with HS256, HTTPS enforced, input validation
- **Scalability**: Stateless API design for horizontal scaling
- **Maintainability**: Clear separation of concerns between layers

---