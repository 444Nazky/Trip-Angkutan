# Architecture.md

## 1. System Architecture Overview

Trip Angkutan follows a client-server architecture with three main components:
1. Mobile Application (Ionic + React)
2. Backend API (Node.js + Express + SQLite)
3. Admin Dashboard (CodeIgniter 2.2.4 + React static build)

## 2. Component Diagram

```
+-------------------+       HTTP/REST       +---------------------+
|   MOBILE APP      | <--------------------> |    BACKEND API      |
| (Ionic + React)   |                       | (Node.js + Express) |
+-------------------+                       +---------------------+
        |                                         |
        | HTTP requests/responses                 | SQL queries
        v                                         v
+-------------------+                       +---------------------+
|   LOCAL STORAGE   | <------------------- |   SQLITE DATABASE   |
+-------------------+                       +---------------------+
        |                                         |
        | Data persistence                      | Data processing
        v                                         v
+-------------------+                       +---------------------+
| ADMIN DASHBOARD   | <----------------- |  STATIC FILES       |
| (CodeIgniter 2.2) |  (React build)     |  (www/ folder)      |
+-------------------+                       +---------------------+
```

## 5. Technology Stack

| Layer | Technology | Details |
|-------|------------|---------|
| Mobile | Ionic + React | Capacitor for native features, Tailwind CSS for styling |
| Backend | Node.js + Express | SQLite via sql.js (sql.js wrapper) |
| Admin | CodeIgniter 2.2.4 | Serves static React build from `www/` directory |
| Database | SQLite | sql.js wrapper for JavaScript access |
| Auth | JWT (HS256) | 24-hour expiry, role-based access |

## 5. Database Schema

### 5.1 Core Tables
- `regions`: Region codes (BADAU, SJRE, SBDZ, ENTIKONG)
- `officers`: Field officers with region assignments
- `officer_regions`: Many-to-many officer-region relationship
- `tariffs`: Master tariffs by vehicle type and load status
- `region_tariffs`: Region-specific tariff configuration
- `vehicle_plates`: Plate registration with status (internal/lokal/eksternal)
- `trips`: Trip records with route and status
- `vehicles`: Vehicle records linked to trips
- `trip_vehicles`: Junction table for trip-vehicle relationship

### 5.5 Database Operations
- **sql.js Wrapper**: Converts `undefined` to `null` for proper binding
- **Migrations**: Automatic schema updates for column additions
- **Seed Data**: Initial region, officer, and tariff data

## 5. API Design
### 5.1 Authentication
- JWT-based authentication with 24-hour expiry
- Role-based access control (admin/officer)
- Middleware: `authenticate` and `requireAdmin`

### 5.3 RESTful API Structure
- `/api/auth/*` - Authentication management
- `/api/trips/*` - Trip management
- `/api/vehicles` - Vehicle management
- `/api/plates` - Plate registration and verification
- `/api/region-tariffs` - Tariff configuration
- `/api/reports/*` - Reporting endpoints

## 5.5 Deployment Architecture
- **Development**: 
  - Backend: `npm start` (port 3000)
  - Mobile: `npm start` (port 5173)
  - Admin: `php -S localhost:8000` (port 8000)
- **Production**:
  - Backend: PM2 process manager
  - Mobile: Build → Capacitor sync → Android deployment
  - Admin: Copy `www/` folder to web server, configure CodeIgniter

## 5.5 Error Handling
- **401 Unauthorized**: Token missing or expired
- **403 Forbidden**: Invalid token or insufficient permissions
- **404 Not Found**: Invalid endpoint or resource
- **500 Internal Server Error**: Unhandled exceptions
- **Sync Errors**: Auto-retry with exponential backoff

---