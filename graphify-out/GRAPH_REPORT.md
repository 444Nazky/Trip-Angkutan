# Graph Report - Aplikasi-Trip-Ionic  (2026-09-23)

## Corpus Check
- 73 files · ~124,637 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 511 nodes · 719 edges · 74 communities (43 shown, 31 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5e4ff1bc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- @capacitor/status-bar
- @angular/core
- dependencies
- data.ts
- store.tsx
- devDependencies
- app
- options
- sync.ts
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
- api.ts
- environment.prod.ts
- styles
- Trip Angkutan
- index.js
- admin/package.json
- tariffs.js
- global.d.ts
- db.js
- trips.js
- routes/auth.js
- officers.js
- regions.js
- reports.js
- middleware/auth.js
- @angular/forms
- @ionic/react-router
- ionicons
- lucide-react
- Angular Component
- package.json
- dependencies
- @angular/compiler
- @angular/platform-browser
- @angular/platform-browser-dynamic
- @angular/router
- @capacitor/android
- @capacitor/app
- @capacitor/geolocation
- @capacitor/haptics
- @capacitor/ios
- @capacitor/keyboard
- @capacitor/network
- @capacitor/preferences
- @ionic/angular
- @ionic/react
- @ionic/storage-angular
- react-dom
- react-router
- react-router-dom
- rxjs
- tslib

## God Nodes (most connected - your core abstractions)
1. `MobileScreen` - 30 edges
2. `useApp()` - 29 edges
3. `Trip Angkutan` - 14 edges
4. `Angular Component` - 11 edges
5. `Trip Angkutan Android` - 11 edges
6. `options` - 10 edges
7. `ApiService` - 10 edges
8. `processSyncQueue()` - 10 edges
9. `Angular Component Patterns` - 10 edges
10. `TripActiveScreen()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Shell()` --calls--> `useApp()`  [EXTRACTED]
  src/App.tsx → src/pages/store.tsx
- `HomeScreenProps` --references--> `MobileScreen`  [EXTRACTED]
  src/pages/mobile/HomeScreen.tsx → src/pages/types.ts
- `CameraScreenProps` --references--> `MobileScreen`  [EXTRACTED]
  src/pages/mobile/CameraScreen.tsx → src/pages/types.ts
- `HistoryDetailScreenProps` --references--> `MobileScreen`  [EXTRACTED]
  src/pages/mobile/HistoryDetailScreen.tsx → src/pages/types.ts
- `HistoryScreenProps` --references--> `MobileScreen`  [EXTRACTED]
  src/pages/mobile/HistoryScreen.tsx → src/pages/types.ts

## Import Cycles
- None detected.

## Communities (74 total, 31 thin omitted)

### Community 2 - "dependencies"
Cohesion: 0.10
Nodes (20): dependencies, bcryptjs, better-sqlite3, cors, express, jsonwebtoken, uuid, description (+12 more)

### Community 3 - "data.ts"
Cohesion: 0.12
Nodes (17): App(), Shell(), AdminDashboard(), AdminDashboardProps, Officer, TariffRow, Toast, allTrips (+9 more)

### Community 4 - "store.tsx"
Cohesion: 0.07
Nodes (57): ROUTES, CameraScreen(), CameraScreenProps, FloatingBottomNav(), FloatingBottomNavProps, NavItem, navItems, HistoryDetailScreen() (+49 more)

### Community 5 - "devDependencies"
Cohesion: 0.06
Nodes (35): @angular/build, @angular/compiler-cli, angular-eslint, @angular/language-service, autoprefixer, @capacitor/cli, eslint, @ionic/angular-toolkit (+27 more)

### Community 6 - "app"
Cohesion: 0.09
Nodes (21): prefix, projectType, root, schematics, sourceRoot, analytics, schematicCollections, standalone (+13 more)

### Community 7 - "options"
Cohesion: 0.20
Nodes (10): options, assets, browser, index, inlineStyleLanguage, outputPath, polyfills, scripts (+2 more)

### Community 8 - "sync.ts"
Cohesion: 0.20
Nodes (17): HomeScreen(), HomeScreenProps, compactRp(), Trip, addToSyncQueue(), getPendingCount(), getSyncQueue(), initializeSync() (+9 more)

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

### Community 20 - "api.ts"
Cohesion: 0.11
Nodes (14): environment, api, ApiError, ApiResponse, ApiService, LoginResponse, OfficerInfo, clearOfficer() (+6 more)

### Community 28 - "styles"
Cohesion: 0.50
Nodes (4): styles, src/global.scss, src/index.css, src/theme/variables.scss

### Community 29 - "Trip Angkutan"
Cohesion: 0.13
Nodes (14): Alur Aplikasi, Android, API, Build, Data Lokal, Development, Fitur Utama, Instalasi (+6 more)

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

### Community 47 - "Angular Component"
Cohesion: 0.08
Nodes (24): Angular Component Patterns, Attribute Directives on Components, Child to Parent (Outputs), Component Communication Patterns, Content Queries, Dependency Injection in Components, Dynamic Components, Error Boundaries (+16 more)

### Community 48 - "package.json"
Cohesion: 0.15
Nodes (12): author, homepage, name, private, scripts, build, lint, ng (+4 more)

### Community 52 - "dependencies"
Cohesion: 0.22
Nodes (9): @angular/common, @capacitor/camera, @capacitor/core, dependencies, @angular/common, @capacitor/camera, @capacitor/core, react (+1 more)

## Knowledge Gaps
- **245 isolated node(s):** `name`, `version`, `dev`, `start`, `serve` (+240 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@capacitor/status-bar`, `@angular/core`, `@angular/forms`, `@ionic/react-router`, `ionicons`, `lucide-react`, `package.json`, `@angular/compiler`, `@angular/platform-browser`, `@angular/platform-browser-dynamic`, `@angular/router`, `@capacitor/android`, `@capacitor/app`, `@capacitor/geolocation`, `@capacitor/haptics`, `@capacitor/ios`, `@capacitor/keyboard`, `@capacitor/network`, `@capacitor/preferences`, `@ionic/angular`, `@ionic/react`, `@ionic/storage-angular`, `react-dom`, `react-router`, `react-router-dom`, `rxjs`, `tslib`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `name`, `version`, `dev` to the rest of the system?**
  _245 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `data.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11956521739130435 - nodes in this community are weakly interconnected._
- **Should `store.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07027027027027027 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._