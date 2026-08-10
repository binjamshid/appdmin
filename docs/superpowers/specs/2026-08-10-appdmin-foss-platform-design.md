# Appdmin FOSS Platform Design

**Status:** Approved for autonomous implementation\
**Date:** 2026-08-10\
**License:** AGPL-3.0-or-later

## Summary

Appdmin is a self-hosted, single-owner operations console for software products. It discovers the
owner's product catalog and operational facts from App Store Connect, inference providers,
OpenTelemetry, and installable adapters. The core never contains portfolio names, product IDs,
prices, domains, infrastructure addresses, or synthesized business facts.

The product keeps the premium, calm, information-rich character of the existing dashboard while
turning every portfolio-specific feature into a capability supplied by a permissioned adapter.
Docker Compose and native systemd are equal installation targets. The first administrator is created
by the CLI; the GUI then guides the owner through workspace and integration onboarding.

## Product principles

1. **Source truth before visual completeness.** Unknown, unavailable, stale, partial, and zero are
   different states. Missing facts are never guessed.
2. **One trusted kernel.** Authentication, authorization, encrypted configuration, normalization,
   provenance, actions, auditing, and installation lifecycle belong to Appdmin core.
3. **Adapters are untrusted by default.** Bundled and third-party adapters use the same public
   contract and run with manifest-scoped permissions.
4. **Capabilities shape the interface.** Navigation and actions appear only when installed adapters
   provide their required capabilities.
5. **One owner, excellent operations.** Version one deliberately excludes teams, organizations,
   invitations, and role matrices.
6. **Deployment parity is a feature.** Docker Compose and systemd must both pass release checks.

## Architecture

### Trusted core

The Deno/Hono application owns:

- single-owner authentication, passkeys, TOTP, recovery codes, sessions, CSRF, and step-up;
- AES-256-GCM encrypted configuration using a deployment-supplied 32-byte master key;
- the adapter registry, pinned source references, manifest digests, and granted permissions;
- the adapter-discovered product catalog plus owner labels, groups, visibility, and notes;
- normalized observations, source provenance, collection windows, quality, and freshness;
- scheduled collection, adapter health, timeouts, circuit breakers, and last-success metadata;
- mediated actions with validation, step-up, idempotency, and append-only audit events;
- the GUI, onboarding state, HTTP API, CLI service operations, migrations, and diagnostics.

PostgreSQL is the durable system of record. Deployment secrets are limited to `DATABASE_URL`,
`APPDMIN_SECRET_KEY`, and boot/runtime settings such as bind address and public origin. Integration
credentials and ordinary settings live encrypted in PostgreSQL.

### Adapter runner and SDK

An adapter package contains `appdmin.adapter.json` and a Deno/TypeScript entrypoint. Sources may be
a local path or a pinned JSR, npm, or Git reference. Installation records the resolved reference and
content digest. Mutable, unpinned remote references are rejected for production activation.

Each adapter runs in a separate Deno subprocess. The core calculates Deno permissions solely from
the accepted manifest: network hosts, readable/writable paths, environment variable names, and
executable names. There is no ambient `--allow-all`. The protocol is newline-delimited JSON-RPC over
stdin/stdout. Stderr is treated as structured operational logging and is secret-redacted.

The versioned SDK defines these optional capabilities:

- `catalog.discover`: products and stable external identifiers;
- `metrics.collect`: scalar/time-series product observations;
- `costs.collect`: currency amounts and token/request usage;
- `people.search` and `people.detail`: privacy-bounded account facts;
- `actions.list` and `actions.execute`: adapter-declared write operations;
- `mail.accounts`, `mail.messages`, and `mail.send`;
- `infrastructure.collect`: services, hosts, storage, certificates, and backups;
- `health.check`: adapter and upstream health.

The core supplies `initialize`, `capabilities`, `configure.validate`, `catalog.discover`,
collection, query, action, and health request envelopes. Every response is schema-validated.
Protocol versions are negotiated; incompatible adapters remain installed but disabled with an exact
diagnostic.

### Bundled adapters

The repository ships adapters for:

- App Store Connect;
- OpenAI;
- Anthropic;
- Google Gemini;
- OpenRouter;
- generic OpenAI-compatible endpoints;
- metadata-only OpenTelemetry usage ingestion.

They use the same SDK and runner as community adapters. The existing private portfolio collectors,
SQL, mail assumptions, service names, and domains are removed from the public core and belong in a
separate private adapter package outside this repository.

## Data and truth model

### Product catalog

Products originate only from adapters. An adapter supplies its stable source ID, kind, name,
platform, optional icon, and source link. The owner may rename, group, annotate, or hide the local
catalog entry but may not create a product that has no source. Multiple source products can be
linked into one logical product while retaining each source identity.

### Observations

Every normalized observation contains:

- adapter instance and optional product identity;
- a namespaced metric key and semantic type;
- numeric, text, boolean, or structured value;
- unit and optional currency;
- interval start/end and collection timestamp;
- quality: `live`, `delayed`, `partial`, `estimated`, `stale`, `unavailable`, or `no_source`;
- source label, optional source URL, definition, timezone, and notes.

Provider reports are authoritative for provider totals. OpenTelemetry may add request/product/model
attribution and latency, but does not overwrite a provider total. If totals cannot be reconciled,
the UI shows both with a discrepancy warning. The OTLP endpoint accepts metadata and numeric usage;
prompt and response content is dropped and never stored. Price data comes from provider APIs or
owner configuration and is versioned with effective dates. No default price is silently assumed.

Collection uses upserts keyed by adapter, product, metric, source interval, and provider record ID.
The UI may use the last successful value only when it is explicitly labeled stale and shows its
collection time. Adapter failure never turns a previous number into zero.

## Security and sensitive actions

The CLI creates the only owner. The owner must have a password and TOTP before first GUI sign-in and
is encouraged to add a passkey during onboarding. Password-only sign-in is not permitted.

At adapter installation, Appdmin displays the complete permission manifest and requires explicit
acceptance. Permissions are manifest-controlled rather than individually toggled afterward; any
manifest permission change requires re-acceptance. Credentials are write-only after entry and are
redacted from APIs, logs, diagnostics, exports, and adapter error messages.

All adapter writes pass through the core. The action descriptor declares risk, confirmation copy,
required input schema, and idempotency support. Sensitive actions require a recent second-factor
step-up. The core records intent, actor, adapter, product, redacted input summary, idempotency key,
outcome, and timestamps in the append-only audit log. Timeouts do not automatically retry
non-idempotent actions.

## GUI and onboarding

### Application shell

The interface uses a compact desktop sidebar and mobile bottom navigation. It keeps premium
restraint through precise typography, neutral surfaces, limited accent color, disciplined spacing,
and subtle motion. Information density comes from structured tables, source disclosures, compact
trends, and progressive detail rather than decorative cards.

Primary destinations are Overview, Products, Costs, People, Operations, Actions, Audit, and
Settings. A destination is hidden when no active adapter provides its capability, except Overview,
Products, Audit, and Settings. Unknown and unavailable states carry source and remediation copy.

### Guided onboarding

After CLI owner creation, the first GUI session opens a resumable five-step route:

1. **Workspace:** public name, compact name, accent, timezone, and currency display preference.
2. **Security:** confirm TOTP/recovery-code readiness and offer passkey enrollment.
3. **Products:** install/configure App Store Connect or another catalog adapter, test it, discover
   products, and choose visibility/grouping.
4. **Providers:** configure any bundled inference adapters and optional OTLP ingestion, test each
   connection, and explain what each source can and cannot measure.
5. **Review:** show product count, enabled capabilities, freshness, unresolved warnings, and the
   exact next collection time before entering the dashboard.

Desktop uses a persistent progress rail; mobile uses a compact progress header. Each step saves
independently and can be resumed. Connection tests have loading, success, authentication failure,
permission failure, rate-limit, timeout, and schema-mismatch states. Skipping integrations is
allowed, but the resulting empty dashboard explains how to add one.

Settings contains Workspace, Security, Integrations, Data & privacy, and System. Integration detail
shows source pin, digest, capabilities, accepted permissions, credential status, last success,
latency, recent sanitized failures, schedules, and remove/disable/update controls.

## CLI and installation

The executable is `appdmin`. Commands use the same service layer and validation rules as the GUI:

- `appdmin init` creates configuration and installation assets;
- `appdmin install --target docker|systemd` renders and validates the chosen deployment;
- `appdmin admin create` creates the sole owner and one-time recovery material;
- `appdmin migrate` applies schema migrations with advisory locking;
- `appdmin adapter add|list|inspect|enable|disable|remove|doctor` manages adapters;
- `appdmin doctor` checks database, key, origin, filesystem, subprocess, and upstream readiness;
- `appdmin backup|restore` handles encrypted application data with explicit confirmation;
- `appdmin upgrade` checks compatibility, backs up, migrates, and restarts safely;
- `appdmin serve` starts the HTTP and scheduler process.

Docker Compose supports Linux and macOS development with pinned application and PostgreSQL images,
health checks, a persistent volume, and a generated secret file. Native systemd supports Debian 12,
Ubuntu 24.04, and compatible systemd distributions on amd64 and arm64. It creates a locked service
user, `/etc/appdmin/appdmin.env`, `/var/lib/appdmin`, a hardened service unit, and optional reverse
proxy examples. The service never runs as root.

## Failures and observability

Adapter calls have per-method deadlines, bounded output, cancellation, and a circuit breaker. Health
states are `healthy`, `degraded`, `failing`, `disabled`, and `incompatible`. The core stores a
sanitized recent error summary and last-success metadata. Logs are structured JSON in production and
human-readable locally; credentials and configured secret values are scrubbed.

The dashboard distinguishes upstream delay, adapter failure, missing permission, no configured
source, and an empty valid result. It provides corrective actions without exposing secrets.

## Repository and FOSS release

The public repository is named Appdmin and contains:

- AGPL-3.0 license and package metadata;
- architecture, adapter authoring, security, installation, operations, and contribution docs;
- a code of conduct, security policy, issue templates, changelog, and example configuration;
- generic fixtures and a sample adapter with fictional data available only in tests/development;
- CI for formatting, linting, type checking, unit/integration tests, browser tests, secret scanning,
  Docker build, Compose smoke test, and systemd unit verification;
- no private hostnames, IP addresses, credentials, identifiers, mailbox names, prices, or product
  schemas in code, docs, test snapshots, Git history prepared by this workspace, or release assets.

## Test and release criteria

Release is blocked unless:

1. all normalization and unavailable/stale truth rules have unit tests;
2. encrypted configuration never returns plaintext through API serialization;
3. an adapter cannot access undeclared network, filesystem, environment, or executable resources;
4. manifest changes invalidate prior permission acceptance;
5. sensitive writes require step-up and create audit entries for success, failure, and timeout;
6. onboarding resumes correctly and works at representative mobile and desktop widths;
7. every capability-driven destination has loading, empty, partial, stale, failure, and success UI;
8. ASC and inference adapter contract tests pass using recorded synthetic fixtures;
9. Docker Compose reaches a healthy state and can create an owner;
10. systemd assets pass syntax/security checks and the documented native smoke path;
11. the repository-wide private-term and secret scan is clean;
12. a fresh clone can follow the README to a working empty Appdmin instance.

## Explicit non-goals for version one

- multi-user, multi-role, or multi-organization administration;
- a hosted Appdmin cloud service or adapter marketplace;
- manually invented catalog products or guessed telemetry;
- storage of inference prompts or responses;
- unrestricted in-process third-party code;
- automatic migration of the original private portfolio deployment.
