# Appdmin FOSS Platform Implementation Plan

> Execute test-first and keep the repository runnable after each phase. The approved design is in
> `docs/superpowers/specs/2026-08-10-appdmin-foss-platform-design.md`.

**Goal:** Replace the portfolio-specific dashboard with a releasable, generic Appdmin core,
permissioned adapter system, bundled ASC/inference integrations, guided GUI onboarding, CLI, and
verified Docker Compose/systemd deployment paths.

**Architecture:** Deno/Hono trusted kernel with PostgreSQL, a versioned JSON-RPC adapter SDK, and
one capability-scoped Deno subprocess per adapter. The GUI and CLI share core service modules.

**Stack:** Deno 2, TypeScript, Hono, PostgreSQL, Web Crypto, WebAuthn, server-rendered shell plus
native ES modules, Docker Compose, systemd, and Playwright browser verification.

---

## Phase 1: Public product skeleton and privacy boundary

- Rename the runtime, package, interface, and documentation to Appdmin.
- Add AGPL license, contributor/security/community files, release metadata, `.env.example`, and
  private-data scanner.
- Replace the product brief with the generic Appdmin audience and principles.
- Delete portfolio-specific collectors, SQL, deployment assets, scripts, routes, and copy once their
  generic replacements exist.
- Add a failing repository privacy test first, then make it pass.

## Phase 2: Generic database and domain core

- Add a fresh consolidated schema for workspace settings, onboarding, encrypted settings, adapters,
  products, product links, observations, actions, audit, and authentication.
- Implement encrypted configuration repositories with redacted serialization.
- Implement product discovery reconciliation and owner metadata.
- Implement normalized observations, quality/freshness semantics, authoritative source rules, and
  provider/OTLP reconciliation.
- Unit test schema validation, encryption, catalog reconciliation, upserts, and truth semantics.

## Phase 3: Adapter SDK and sandbox runner

- Define versioned manifest, permission, capability, JSON-RPC, product, observation, action, health,
  and configuration types.
- Validate manifests and pin/digest adapter sources.
- Implement the subprocess command builder, permission allowlists, RPC framing, deadlines, output
  bounds, cancellation, structured redacted logs, health, and circuit breaker.
- Add synthetic sample adapters that prove allowed calls work and undeclared access fails.
- Contract-test initialization, discovery, collection, errors, incompatibility, and writes.

## Phase 4: Bundled adapters

- Implement App Store Connect JWT authentication, paginated catalog discovery, sales/subscription
  report normalization, and exact unavailable states.
- Implement shared inference accounting utilities and OpenAI, Anthropic, Gemini, OpenRouter, and
  OpenAI-compatible adapters using official usage/cost endpoints where available.
- Implement an OTLP HTTP ingestion adapter/endpoint that accepts only numeric usage metadata and
  rejects/drops prompt or completion content.
- Use synthetic fixtures only; do not ship credentials or user data.

## Phase 5: Core API, scheduler, and sensitive actions

- Replace portfolio endpoints with generic workspace, onboarding, adapters, products, metrics,
  costs, actions, audit, and system-health endpoints.
- Add collection scheduling, idempotent observation persistence, last-success state, timeouts, and
  circuit breaking.
- Route all writes through action policy, recent step-up, idempotency, and append-only audit.
- Test authorization, CSRF, redaction, action success/failure/timeout, and capability filtering.

## Phase 6: Polished GUI and onboarding

- Build the responsive Appdmin shell, design tokens, desktop sidebar, mobile navigation, status
  system, tables, disclosures, dialogs, toasts, skeletons, and exact empty/failure states.
- Build resumable Workspace, Security, Products, Providers, and Review onboarding steps.
- Build capability-aware Overview, Products, Costs, People, Operations, Actions, Audit, Workspace,
  Integrations, Security, Data & privacy, and System views.
- Browser-test keyboard/touch interaction, responsive layouts, onboarding resume, connection tests,
  secret non-disclosure, and sensitive confirmation.

## Phase 7: CLI and deployment parity

- Create the `appdmin` CLI with init, serve, migrate, admin, adapter, doctor, backup, restore,
  upgrade, and install commands.
- Add Dockerfile, Compose file, health checks, generated configuration, and a Compose smoke test.
- Add hardened systemd service/tmpfiles examples and an installer that supports dry-run and explicit
  paths; validate with systemd-analyze where available.
- Document Linux production and macOS development paths for amd64 and arm64.

## Phase 8: Release verification and handoff

- Format, lint, type-check, unit/integration test, and run browser tests.
- Build the container and verify Compose where the local runtime permits it.
- Verify CLI help, init dry-run, migration discovery, manifest validation, doctor output, systemd
  units, example configuration, and fresh-start instructions.
- Run repository private-term, credential-pattern, placeholder, and stale-file scans.
- Review the final diff and documentation for a first-time open-source maintainer.
- Produce a release-readiness report with any host-dependent checks clearly separated from verified
  failures. Do not claim checks that the current host cannot run.
