# Graph Report - Aplikasi-Trip-Ionic  (2026-09-22)

## Corpus Check
- 51 files · ~113,647 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 382 nodes · 400 edges · 60 communities (30 shown, 30 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b983a8e0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- @capacitor/status-bar
- dependencies
- dependencies
- App.tsx
- devDependencies
- app
- options
- Trip Angkutan Android
- development
- org.junit.Test
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
- db.js
- trips.js
- routes/auth.js
- officers.js
- regions.js
- reports.js
- middleware/auth.js
- Angular Component
- package.json
- @angular/common
- @angular/compiler
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
1. `Trip Angkutan` - 14 edges
2. `Angular Component` - 11 edges
3. `Trip Angkutan Android` - 11 edges
4. `options` - 10 edges
5. `Angular Component Patterns` - 10 edges
6. `app` - 7 edges
7. `development` - 7 edges
8. `authenticate()` - 7 edges
9. `scripts` - 7 edges
10. `architect` - 6 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (60 total, 30 thin omitted)

### Community 1 - "dependencies"
Cohesion: 0.22
Nodes (9): @angular/core, @angular/forms, @ionic/react-router, ionicons, dependencies, @angular/core, @angular/forms, @ionic/react-router (+1 more)

### Community 2 - "dependencies"
Cohesion: 0.10
Nodes (20): dependencies, bcryptjs, better-sqlite3, cors, express, jsonwebtoken, uuid, description (+12 more)

### Community 3 - "App.tsx"
Cohesion: 0.09
Nodes (20): App(), demoTrips, container, CreateTripPage(), StatusMuatan, HistoryPage(), Trip, HomePage() (+12 more)

### Community 5 - "devDependencies"
Cohesion: 0.07
Nodes (29): @angular/build, @angular/compiler-cli, angular-eslint, @angular/language-service, @capacitor/cli, eslint, @ionic/angular-toolkit, jsdom (+21 more)

### Community 6 - "app"
Cohesion: 0.09
Nodes (21): prefix, projectType, root, schematics, sourceRoot, analytics, schematicCollections, standalone (+13 more)

### Community 7 - "options"
Cohesion: 0.15
Nodes (13): options, assets, browser, index, inlineStyleLanguage, outputPath, polyfills, scripts (+5 more)

### Community 9 - "Trip Angkutan Android"
Cohesion: 0.17
Nodes (11): Backend integration, Configuration, Development workflow, Features, Prerequisites, Project structure, Release builds, Running and debugging (+3 more)

### Community 10 - "development"
Cohesion: 0.06
Nodes (40): architect, build, extract-i18n, lint, serve, test, builder, configurations (+32 more)

### Community 12 - "org.junit.Test"
Cohesion: 0.36
Nodes (4): ExampleInstrumentedTest, ExampleUnitTest, org.junit.runner.RunWith, org.junit.Test

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

### Community 47 - "Angular Component"
Cohesion: 0.08
Nodes (24): Angular Component Patterns, Attribute Directives on Components, Child to Parent (Outputs), Component Communication Patterns, Content Queries, Dependency Injection in Components, Dynamic Components, Error Boundaries (+16 more)

### Community 48 - "package.json"
Cohesion: 0.15
Nodes (12): author, homepage, name, private, scripts, build, lint, ng (+4 more)

## Knowledge Gaps
- **222 isolated node(s):** `name`, `version`, `dev`, `start`, `serve` (+217 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@capacitor/status-bar`, `package.json`, `@angular/common`, `@angular/compiler`, `@angular/platform-browser`, `@angular/platform-browser-dynamic`, `@angular/router`, `@capacitor/android`, `@capacitor/app`, `@capacitor/camera`, `@capacitor/core`, `@capacitor/geolocation`, `@capacitor/haptics`, `@capacitor/ios`, `@capacitor/keyboard`, `@capacitor/network`, `@capacitor/preferences`, `@ionic/angular`, `@ionic/react`, `@ionic/storage-angular`, `react`, `react-dom`, `react-router`, `react-router-dom`, `rxjs`, `tslib`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `architect` connect `development` to `app`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `dev` to the rest of the system?**
  _222 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08602150537634409 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._