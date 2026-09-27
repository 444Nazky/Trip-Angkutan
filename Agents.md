# Agents.md

## 1. Officer Management Overview

The system manages field officers (petugas) with support for:
- Role-based access control (admin/officer)
- Many-to-many relationship with regions
- Status management (aktif/nonaktif)
- Region access control
- Synchronization between mobile and admin systems

## 2. Officer Data Model

### 5.1 Officer Structure
- **id**: UUID or legacy numeric ID (string format)
- **name**: Officer's full name
- **pin**: BCrypt-hashed 6-digit PIN
- **region_id**: Primary region assignment (fallback for JWT claims)
- **is_active**: 1 = Aktif, 0 = Nonaktif
- **regions**: Array of regions the officer can access (many-to-many)

### 5.2 Officer-JWT Claims
- `officerId`: Officer's unique identifier
- `regionId`: Region ID from `region_id` field
- `role`: 'officer' (never 'admin')
- **Additional**: `isDualAccess` flag for officers with access to multiple regions

## 5.3 Officer Management Flow

### 5.1 Officer Login
1. Officer enters credentials (username/password or PIN)
2. System validates credentials against database
3. JWT token issued with officer data
4. Token stored in localStorage and used in API requests

### 5.5 Region Access Management
- **Many-to-Many**: One officer can access multiple regions
- **Admin Control**: `PUT /officers/:id/regions` endpoint
- **Token Refresh**: `POST /api/auth/refresh` ensures latest region claims

## 3. Key Endpoints

### 5.1 Officer Management
- `GET /api/officers` - Admin-only: list all officers
- `GET /api/officers/my-region` - Officer-only: list officers in same region
- `POST /api/officers` - Admin-only: create new officer
- `PUT /api/officers/:id/regions` - Admin-only: update region access
- `PUT /api/officers/:id/status` - Admin-only: toggle active status
- `DELETE /api/officers/:id` - Admin-only: remove officer

### 5.5 Officer Switching
- Mobile app shows "Ganti Petugas" screen
- Officer selects new login → app calls `POST /api/auth/login` with new officer ID
- Token refresh ensures new region claims are used
- Offline support: cached officer list updated on next sync

## 3. Sync & Offline Support

### 5.1 Sync Mechanism
- **Sync Queue**: Managed in `src/services/sync.ts`
- **Auto-sync**: Network change detection or periodic intervals
- **Retry Logic**: Max 3 attempts with exponential backoff
- **Conflict Resolution**: Server data always wins

### 5.5 Caching Strategy
- **5-minute cache** for officer lists to reduce API calls
- **Force refresh** option for immediate updates (switch-account screen)
- **Local storage**: `trip.officers.v1` key stores mobile-formatted officers

## 6. Error Handling

### 5.1 Common Errors
- **401 Unauthorized**: Token expired or invalid
- **403 Forbidden**: Token valid but insufficient permissions
- **404 Not Found**: Invalid endpoint or resource
- **401 during refresh**: Officer nonaktif → sesi otomatis berakhir

### 5.2 Recovery Flow
1. Officer attempts operation → 401 response
2. Mobile app shows login screen
3. Officer re-authenticates → new token obtained
4. Sync resumes automatically

## 6. Security Considerations

- **PIN Security**: Stored as bcrypt hash, never transmitted
- **Token Security**: Short-lived JWT (24h), HTTPS enforced
- **Data Protection**: 
  - Sensitive data (PIN) never transmitted
  - JWT tokens never stored in localStorage without encryption
  - Admin credentials separate from officer credentials

## 6. Implementation Notes

- **Backend**: Uses `officer_id` in JWT claims, not mobile-assigned IDs
- **Region Mapping**: Admin sets `region_id` in DB, mobile uses `region_code` for display
- **Legacy Support**: Supports both UUID and legacy "1".."5" officer IDs
- **Dual Access**: Special handling for officers with access to multiple regions

---