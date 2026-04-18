# SecureYeoman — Claude Code Instructions

## Project Identity

**SecureYeoman** — Secure, local-first AI assistant

- **Type**: Hybrid Rust + TypeScript monorepo (migrating TS → Rust via AGNOS ecosystem crates)
- **License**: AGPL-3.0-only
- **Node**: >=22.0.0
- **Rust**: Edition 2024, rust-version 1.91
- **Version**: SemVer `MAJOR.MINOR.PATCH` starting from 0.5.0 (Rust-native era). Previous CalVer releases are historical

## Monorepo Structure

```
crates/       — Rust workspace (single crate `sy-core` with two binaries: `sy-core` and `sy-edge`)
packages/
  core/       — Backend (TypeScript, being phased out → Rust via AGNOS crates)
  dashboard/  — React frontend
  desktop/    — Tauri v2 desktop app
  mcp/        — MCP server and tools
  mobile/     — Capacitor mobile app
  shared/     — Shared types and utilities
docs/
  adr/        — Architecture decision records (001–044)
  development/roadmap.md — open items only (completed work → CHANGELOG)
```

## Migration Direction

TypeScript is being phased out in favor of Rust via AGNOS ecosystem crates. SY is converging with the AGNOS system. The `sy-core` crate is a flat monolith (Phase 10 complete) containing crypto, audit, privacy, sandbox, tee, hwprobe, types, and the edge runtime as sibling modules. It ships two binaries: `sy-core` (server) and `sy-edge` (fleet runtime). New features should prefer Rust.

## Development Process

### P(-1): Scaffold Hardening (before any new features)

0. Read roadmap, CHANGELOG, and open issues — know what was intended before auditing what was built
1. Test sweep of existing code
2. Cleanliness check: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run security:audit`
3. For Rust crates: `cargo fmt --check`, `cargo clippy --all-features --all-targets -- -D warnings`, `cargo audit`, `cargo deny check`, `RUSTDOCFLAGS="-D warnings" cargo doc --all-features --no-deps`
4. Internal deep review — gaps, optimizations, security, logging/errors, docs
5. External research — domain completeness, missing capabilities, best practices
6. Cleanliness check — must be clean after review
7. Additional tests from findings
8. Repeat if heavy

### Work Loop / Working Loop (continuous)

1. Work phase — new features, roadmap items, bug fixes
2. Cleanliness check: `npm run lint`, `npm run format:check`, `npm run typecheck`
3. Test additions for new code
4. Internal review — performance, security, correctness
5. Cleanliness check — must be clean after review
6. Deeper tests from review observations
7. If review heavy → return to step 4
8. Documentation — update CHANGELOG, roadmap, docs
9. Version check — VERSION and all 7 package.json files in sync (use `npm run version:set`)
10. Return to step 1

### Task Sizing

- **Low/Medium effort**: Batch freely — multiple items per work loop cycle
- **Large effort**: Small bites only — break into sub-tasks, verify each before moving to the next. Never batch large items together
- **If unsure**: Treat it as large. Smaller bites are always safer than overcommitting

### Refactoring

- Refactor when the code tells you to — duplication, unclear boundaries, performance bottlenecks
- Never refactor speculatively. Wait for the third instance before extracting an abstraction
- Refactoring is part of the work loop, not a separate phase. If a review reveals structural issues, refactor before moving on
- Every refactor must pass the same cleanliness gates as new code

## Testing

```bash
npm run test                    # All workspaces
npm run test:e2e                # Core E2E (vitest)
npm run test:e2e:fe             # Dashboard E2E (playwright)
npm run bench                   # Core benchmarks
```

Vitest configs: `vitest.config.ts` (root), `vitest.unit.config.ts`, `vitest.db.config.ts`, `vitest.e2e.config.ts` (all in `packages/core/`)

DB tests require PostgreSQL. E2E tests require Docker (`docker compose --env-file .env.dev`).

## DO NOT

- **Do not commit or push** — the user handles all git operations
- **NEVER use `gh` CLI** — use `curl` to GitHub API only
- Do not add unnecessary dependencies
- Do not skip tests before claiming correctness
- **ALWAYS use `--env-file .env.dev`** with docker compose commands
- Do not install packages on the host — everything runs in Docker

## Documentation Structure

```
Root files (required):
  README.md, CHANGELOG.md, CLAUDE.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, LICENSE

docs/ (required):
  adr/ — architectural decision records
  development/roadmap.md — open items (completed → CHANGELOG)

docs/ (when earned):
  guides/ — usage patterns and examples
```

## CHANGELOG Format

Follow [Keep a Changelog](https://keepachangelog.com/). Performance claims MUST include benchmark numbers. Breaking changes get a **Breaking** section with migration guide.
