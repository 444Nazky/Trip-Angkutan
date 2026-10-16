# Graph Report - android  (2026-10-15)

## Corpus Check
- 11 files · ~18,694 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 33 nodes · 29 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `251b1215`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Trip Angkutan Android
- org.junit.Test
- gradlew
- MainActivity.java

## God Nodes (most connected - your core abstractions)
1. `Trip Angkutan Android` - 11 edges
2. `ExampleInstrumentedTest` - 3 edges
3. `MainActivity` - 2 edges
4. `ExampleUnitTest` - 2 edges
5. `Features` - 1 edges
6. `Technology` - 1 edges
7. `Project structure` - 1 edges
8. `Prerequisites` - 1 edges
9. `Development workflow` - 1 edges
10. `Running and debugging` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (10 total, 1 thin omitted)

### Community 0 - "Trip Angkutan Android"
Cohesion: 0.17
Nodes (11): Backend integration, Configuration, Development workflow, Features, Prerequisites, Project structure, Release builds, Running and debugging (+3 more)

### Community 1 - "org.junit.Test"
Cohesion: 0.36
Nodes (4): ExampleInstrumentedTest, ExampleUnitTest, org.junit.runner.RunWith, org.junit.Test

### Community 2 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

## Knowledge Gaps
- **10 isolated node(s):** `Features`, `Technology`, `Project structure`, `Prerequisites`, `Development workflow` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `Features`, `Technology`, `Project structure` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._