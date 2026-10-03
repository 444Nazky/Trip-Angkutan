# Graph Report - Aplikasi-Trip-Ionic  (2026-09-21)

## Corpus Check
- 58 files · ~17,234 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 396 nodes · 640 edges · 32 communities (25 shown, 7 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `edf55194`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- input-vehicle.page.ts
- dependencies
- ApiService
- TripModel
- StorageService
- devDependencies
- angular.json
- options
- LoginPage
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
- HistoryPage
- app

## God Nodes (most connected - your core abstractions)
1. `StorageService` - 35 edges
2. `TripModel` - 22 edges
3. `AuthService` - 21 edges
4. `InputVehiclePage` - 14 edges
5. `Trip Angkutan` - 14 edges
6. `ApiService` - 13 edges
7. `SyncService` - 13 edges
8. `NetworkService` - 11 edges
9. `TripService` - 11 edges
10. `Trip Angkutan Android` - 11 edges

## Surprising Connections (you probably didn't know these)
- `TripService` --references--> `TripModel`  [EXTRACTED]
  src/app/core/services/trip.service.ts → src/app/data/models/trip.model.ts
- `TripModel` --references--> `VehicleModel`  [EXTRACTED]
  src/app/data/models/trip.model.ts → src/app/data/models/vehicle.model.ts
- `HistoryPage` --references--> `TripModel`  [EXTRACTED]
  src/app/features/trip/history/history.page.ts → src/app/data/models/trip.model.ts
- `SuccessDialogPage` --references--> `TripModel`  [EXTRACTED]
  src/app/features/trip/success-dialog/success-dialog.page.ts → src/app/data/models/trip.model.ts
- `TripDetailPage` --references--> `TripModel`  [EXTRACTED]
  src/app/features/trip/trip-detail/trip-detail.page.ts → src/app/data/models/trip.model.ts

## Import Cycles
- None detected.

## Communities (32 total, 7 thin omitted)

### Community 0 - "input-vehicle.page.ts"
Cohesion: 0.08
Nodes (22): CameraService, Injectable, GpsResult, LocationService, Injectable, TariffService, Injectable, TripService (+14 more)

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (47): @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/platform-browser-dynamic, @angular/router, @capacitor/android (+39 more)

### Community 2 - "ApiService"
Cohesion: 0.13
Nodes (6): ApiService, Injectable, SyncService, Injectable, HomePage, Component

### Community 3 - "TripModel"
Cohesion: 0.08
Nodes (20): AppComponent, Component, routes, API_BASE_URL, APP_CONSTANTS, AuthGuard, Injectable, ApiResponse (+12 more)

### Community 4 - "StorageService"
Cohesion: 0.10
Nodes (9): StorageService, Injectable, TariffModel, ProfilePage, Component, SuccessDialogPage, Component, TripDetailPage (+1 more)

### Community 5 - "devDependencies"
Cohesion: 0.05
Nodes (37): @angular/build, @angular/compiler-cli, angular-eslint, @angular/language-service, @capacitor/cli, eslint, @ionic/angular-toolkit, jsdom (+29 more)

### Community 6 - "angular.json"
Cohesion: 0.12
Nodes (15): analytics, schematicCollections, standalone, styleext, standalone, styleext, cli, newProjectRoot (+7 more)

### Community 7 - "options"
Cohesion: 0.15
Nodes (13): options, assets, browser, index, inlineStyleLanguage, outputPath, polyfills, scripts (+5 more)

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

### Community 31 - "app"
Cohesion: 0.33
Nodes (6): prefix, projectType, root, schematics, sourceRoot, app

## Knowledge Gaps
- **122 isolated node(s):** `$schema`, `version`, `newProjectRoot`, `projectType`, `schematics` (+117 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `StorageService` connect `StorageService` to `input-vehicle.page.ts`, `ApiService`, `TripModel`, `HistoryPage`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `TripModel` connect `TripModel` to `input-vehicle.page.ts`, `ApiService`, `StorageService`, `HistoryPage`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `newProjectRoot` to the rest of the system?**
  _122 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `input-vehicle.page.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08013468013468013 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `ApiService` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._