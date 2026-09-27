# System-Design.md

## 1. System Overview
Trip Angkutan is a transportation management system consisting of:
- Mobile application (Ionic + React) for field officers
- Backend API (Node.js + Express + SQLite) for data processing
- Admin dashboard (CodeIgniter 2.2.4 + React static build) for supervision

## 2. Component Breakdown

### 2.1 Mobile Application (Ionic + React)
- **Frontend**: React with Tailwind CSS
- **Features**:
  - Authentication (JWT)
  - Trip creation workflow
  - Vehicle input (2-step process)
  - Camera capture for documentation
  - Offline-first architecture with sync queue
  - Push notifications for critical events

### 2.2 Backend API (Node.js + Express + SQLite)
- **Endpoint Structure**: RESTful API with JWT authentication
- **Database**: SQLite via sql.js (sql.js wrapper)
- **Key Endpoints**:
  - `/api/auth/*` - Authentication management
  - `/api/trips/*` - Trip management
  - `/api/vehicles` - Vehicle management
  - `/api/plates` - Plate registration and verification
  - `/api/region-tariffs` - Tariff configuration
  - `/api/reports/*` - Reporting and analytics

### 2.3 Admin Dashboard (CodeIgniter 2.2.4)
- **Static Build**: React output served as static files
- **Features**:
  - Tariff management (master + region-specific)
  - Officer management (many-to-many regions)
  - Plate registration and verification
  - Report generation and export
  - Theme and settings configuration

## 3. Data Flow

### 3.1 Normal Operation
1. Officer logs in → receives JWT token
2. Officer creates trip → data stored locally → added to sync queue
3. Officer completes vehicle input → data saved locally
4. Officer submits trip → POST /api/trips with JWT
5. Backend processes trip → saves to SQLite → responds 201
6. Sync queue processes pending trips when online

### 3.2 Offline Operation
1. Officer creates trip → saved to localStorage
2. UI shows "Terputus (Offline mode)"
3. Sync queue maintains pending operations
4. When connection restored → auto-sync to backend

## 4. Authentication Flow
1. Officer opens app → checks for valid JWT in localStorage
2. If no token → shows login screen
3. Officer enters credentials → POST /api/auth/member-login
4. Server validates → returns JWT + officer data
5. Token stored in localStorage and API client
6. All API requests include `Authorization: Bearer <token>` header
7. Token expires after 24 hours → refresh via POST /api/auth/refresh

## 4. Offline Support
- **Local Storage**: 
  - Draft trips and vehicle data
  - Sync queue state
- **Sync Queue**: 
  - Managed in `src/services/sync.ts`
  - Auto-retry with exponential backoff
  - Max 3 retry attempts
- **Conflict Resolution**: Server data takes precedence

## 5. Authentication & Authorization
- **JWT**: HS256 algorithm, 24h expiry
- **Claims**: `officerId`, `regionId`, `role` (admin/officer)
- **Middleware**: 
  - `authenticate` - verifies JWT
  - `requireAdmin` - restricts to admin role
- **Roles**:
  - `admin`: full access to all endpoints
  - `officer`: limited to own region and trips

## 5. Database Design
### 5.1 Core Tables
- `regions`: Region codes (BADAU, SJRE, SBDZ, ENTIKONG)
- `officers`: Field officers with region assignment
- `officer_regions`: Many-to-many officer-region relationship
- `tariffs`: Master tariffs by vehicle type and load status
- `region_tariffs`: Region-specific tariff configuration
- `vehicle_plates`: Plate registration with status (internal/lokal/eksternal)
- `trips`: Trip records with route and status
- `vehicles`: Vehicle records linked to trips
- `trip_vehicles`: Junction table for trip-vehicle relationship

## 4. API Design
### 5.1 Authentication Endpoints
- `POST /api/auth/admin-login` - Admin login
- `POST /api/auth/member-login` - Officer login (username/password)
- `POST /api/auth/login` - PIN login (requires officer ID)
- `POST /api/auth/refresh` - Token refresh (JWT from DB claims)

### 5.2 Trip Endpoints
- `POST /api/trips` - Create trip (requires JWT)
- `GET /api/trips` - List trips (filtered by region for officers)
- `GET /api/trips/:id` - Trip detail
- `POST /api/trips/:id/vehicles` - Add vehicle to trip

### 5.3 Plate Management
- `GET/POST/PUT/DELETE /api/plates` - CRUD for plates
- `POST /api/plates/check` - Verify plate status (internal/lokal/eksternal)

### 5.4 Report Endpoints
- `GET /api/reports/trips` - Detailed trip reports (admin only)
- `GET /api/reports/trips/filters` - Filter options for reports
- `GET /api/reports/trips/export` - Server-side export (fallback)

## 6. Deployment Architecture
- **Development**: 
  - Backend: `npm start` (port 3000)
  - Mobile: `npm start` (port 5173)
  - Admin: `php -S localhost:8000` (port 8000)
- **Production**:
  - Backend: PM2 process manager on server
  - Mobile: Build → Capacitor sync → Android deployment
  - Admin: Copy `www/` folder to web server, symlink to `admin-ci/`

## 7. Security Considerations
- **Authentication**: JWT with HS256 signing
- **Transport**: HTTPS enforced in production
- **Input Validation**: Server-side validation for all endpoints
- **Data Protection**: 
  - Sensitive data (PIN) hashed with bcrypt
  - JWT tokens with short expiry (24h)
  - No sensitive data in URLs

---