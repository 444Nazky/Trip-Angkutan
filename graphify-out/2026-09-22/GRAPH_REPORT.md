# Graph Report - Aplikasi-Trip-Ionic  (2026-09-22)

## Corpus Check
- 83 files · ~120,492 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 554 nodes · 701 edges · 78 communities (42 shown, 36 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7b4fb630`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- location.service.ts
- dependencies
- dependencies
- StorageService
- app-routing.module.ts
- devDependencies
- app
- options
- AuthService
- Trip Angkutan Android
- architect
- production
- org.junit.Test
- ci
- lint
- development
- gradlew
- MainActivity.java
- eslint.config.js
- capacitor.config.ts
- environment.ts
- environment.prod.ts
- Trip Angkutan
- index.js
- admin/package.json
- tariffs.js
- auth/login.page.tsx
- db.js
- trips.js
- routes/auth.js
- officers.js
- regions.js
- reports.js
- middleware/auth.js
- ProfilePage
- tabs.routes.ts
- enums.ts
- AboutPage
- api.constants.ts
- Angular Component
- package.json
- OfficerSelectModal
- CameraService
- trip/history/history.page.tsx
- @angular/common
- @angular/compiler
- @angular/core
- @angular/platform-browser
- @angular/platform-browser-dynamic
- @angular/router
- @capacitor/android
- @capacitor/app
- @capacitor/camera
- @capacitor/core
- @capacitor/geolocation
- @capacitor/haptics
- @capacitor/ios
- @capacitor/keyboard
- @capacitor/network
- @capacitor/preferences
- @ionic/angular
- @ionic/react
- @ionic/storage-angular
- react
- react-dom
- react-router
- react-router-dom
- rxjs
- tslib

## God Nodes (most connected - your core abstractions)
1. `StorageService` - 25 edges
2. `AuthService` - 17 edges
3. `TripModel` - 15 edges
4. `Trip Angkutan` - 14 edges
5. `ApiService` - 13 edges
6. `Angular Component` - 11 edges
7. `Trip Angkutan Android` - 11 edges
8. `options` - 10 edges
9. `NetworkService` - 10 edges
10. `Angular Component Patterns` - 10 edges

## Surprising Connections (you probably didn't know these)
- `AuthService` --references--> `UserModel`  [EXTRACTED]
  src/app/core/services/auth.service.ts → src/app/data/models/user.model.ts
- `TripService` --references--> `TripModel`  [EXTRACTED]
  src/app/core/services/trip.service.ts → src/app/data/models/trip.model.ts
- `VehicleModel` --references--> `Golongan`  [EXTRACTED]
  src/app/data/models/vehicle.model.ts → src/app/data/models/tariff.model.ts
- `VehicleModel` --references--> `JenisKendaraan`  [EXTRACTED]
  src/app/data/models/vehicle.model.ts → src/app/data/models/tariff.model.ts
- `TripModel` --references--> `VehicleModel`  [EXTRACTED]
  src/app/data/models/trip.model.ts → src/app/data/models/vehicle.model.ts

## Import Cycles
- None detected.

## Communities (78 total, 36 thin omitted)

### Community 0 - "location.service.ts"
Cohesion: 0.33
Nodes (5): GpsResult, LocationService, Injectable, isInsideRegion(), RegionModel

### Community 1 - "dependencies"
Cohesion: 0.22
Nodes (9): @angular/forms, @capacitor/status-bar, @ionic/react-router, ionicons, dependencies, @angular/forms, @capacitor/status-bar, @ionic/react-router (+1 more)

### Community 2 - "dependencies"
Cohesion: 0.10
Nodes (20): dependencies, bcryptjs, better-sqlite3, cors, express, jsonwebtoken, uuid, description (+12 more)

### Community 3 - "StorageService"
Cohesion: 0.05
Nodes (31): AppComponent, Component, routes, API_BASE_URL, APP_CONSTANTS, ApiResponse, ApiService, Injectable (+23 more)

### Community 4 - "app-routing.module.ts"
Cohesion: 0.05
Nodes (22): AuthGuard, Injectable, LoginPageProps, HistoryPageProps, Trip, HomePageProps, Trip, ProfilePageProps (+14 more)

### Community 5 - "devDependencies"
Cohesion: 0.07
Nodes (29): @angular/build, @angular/compiler-cli, angular-eslint, @angular/language-service, @capacitor/cli, eslint, @ionic/angular-toolkit, jsdom (+21 more)

### Community 6 - "app"
Cohesion: 0.09
Nodes (21): prefix, projectType, root, schematics, sourceRoot, analytics, schematicCollections, standalone (+13 more)

### Community 7 - "options"
Cohesion: 0.15
Nodes (13): options, assets, browser, index, inlineStyleLanguage, outputPath, polyfills, scripts (+5 more)

### Community 8 - "AuthService"
Cohesion: 0.12
Nodes (6): AuthService, Injectable, SplashPage, Component, PinVerifyModal, Component

### Community 9 - "Trip Angkutan Android"
Cohesion: 0.17
Nodes (11): Backend integration, Configuration, Development workflow, Features, Prerequisites, Project structure, Release builds, Running and debugging (+3 more)

### Community 10 - "architect"
Cohesion: 0.18
Nodes (12): architect, extract-i18n, test, builder, options, buildTarget, setupFiles, tsConfig (+4 more)

### Community 11 - "production"
Cohesion: 0.22
Nodes (9): build, builder, configurations, defaultConfiguration, production, budgets, buildTarget, fileReplacements (+1 more)

### Community 12 - "org.junit.Test"
Cohesion: 0.36
Nodes (4): ExampleInstrumentedTest, ExampleUnitTest, org.junit.runner.RunWith, org.junit.Test

### Community 13 - "ci"
Cohesion: 0.29
Nodes (7): serve, progress, watch, ci, builder, configurations, defaultConfiguration

### Community 14 - "lint"
Cohesion: 0.33
Nodes (6): lint, builder, options, lintFilePatterns, src/**/*.html, src/**/*.ts

### Community 15 - "development"
Cohesion: 0.33
Nodes (6): development, buildTarget, extractLicenses, namedChunks, optimization, sourceMap

### Community 16 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 29 - "Trip Angkutan"
Cohesion: 0.13
Nodes (14): Android, Application Flow, Build, Configuration Files, Development, Features, Installation, License (+6 more)

### Community 30 - "index.js"
Cohesion: 0.17
Nodes (11): app, authRoutes, cors, db, express, officerRoutes, regionRoutes, reportRoutes (+3 more)

### Community 31 - "admin/package.json"
Cohesion: 0.22
Nodes (8): dependencies, serve, name, scripts, dev, start, version, serve

### Community 32 - "tariffs.js"
Cohesion: 0.40
Nodes (4): { authenticate }, db, express, router

### Community 34 - "db.js"
Cohesion: 0.33
Nodes (6): bcrypt, Database, db, initialize(), seedData(), { v4: uuidv4 }

### Community 35 - "trips.js"
Cohesion: 0.29
Nodes (5): { authenticate }, db, express, router, { v4: uuidv4 }

### Community 36 - "routes/auth.js"
Cohesion: 0.33
Nodes (5): bcrypt, db, express, jwt, router

### Community 37 - "officers.js"
Cohesion: 0.33
Nodes (5): { authenticate }, bcrypt, db, express, router

### Community 38 - "regions.js"
Cohesion: 0.40
Nodes (4): { authenticate }, db, express, router

### Community 39 - "reports.js"
Cohesion: 0.40
Nodes (4): { authenticate }, db, express, router

### Community 40 - "middleware/auth.js"
Cohesion: 0.29
Nodes (6): authenticate(), jwt, { authenticate }, db, express, router

### Community 42 - "tabs.routes.ts"
Cohesion: 0.40
Nodes (4): ./history/history.page.tsx, ./home/home.page.tsx, ./profile/profile.page.tsx, routes

### Community 43 - "enums.ts"
Cohesion: 0.50
Nodes (3): Golongan, JenisKendaraan, StatusMuatan

### Community 47 - "Angular Component"
Cohesion: 0.08
Nodes (24): Angular Component Patterns, Attribute Directives on Components, Child to Parent (Outputs), Component Communication Patterns, Content Queries, Dependency Injection in Components, Dynamic Components, Error Boundaries (+16 more)

### Community 48 - "package.json"
Cohesion: 0.15
Nodes (12): author, homepage, name, private, scripts, build, lint, ng (+4 more)

### Community 49 - "OfficerSelectModal"
Cohesion: 0.25
Nodes (3): Officer, OfficerSelectModal, Component

## Knowledge Gaps
- **246 isolated node(s):** `name`, `version`, `dev`, `start`, `serve` (+241 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`, `@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/platform-browser`, `@angular/platform-browser-dynamic`, `@angular/router`, `@capacitor/android`, `@capacitor/app`, `@capacitor/camera`, `@capacitor/core`, `@capacitor/geolocation`, `@capacitor/haptics`, `@capacitor/ios`, `@capacitor/keyboard`, `@capacitor/network`, `@capacitor/preferences`, `@ionic/angular`, `@ionic/react`, `@ionic/storage-angular`, `react`, `react-dom`, `react-router`, `react-router-dom`, `rxjs`, `tslib`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `StorageService` connect `StorageService` to `AuthService`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `name`, `version`, `dev` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `StorageService` be split into smaller, more focused modules?**
  _Cohesion score 0.05381400208986416 - nodes in this community are weakly interconnected._
- **Should `app-routing.module.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._