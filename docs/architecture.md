# Architecture

Appdmin is a trusted Deno/Hono kernel backed by PostgreSQL. The kernel owns the owner account,
sessions, encrypted settings, product catalog, normalized observations, action policy, audit
history, GUI, API, CLI, and scheduler.

Every external integration is an adapter package with `appdmin.adapter.json`. The core validates the
manifest and starts its TypeScript entrypoint in a separate Deno process with only the accepted
network, environment, filesystem, and executable permissions. Core and adapter communicate using
newline-delimited JSON-RPC 2.0 on stdin/stdout.

See the complete design in `docs/superpowers/specs/2026-08-10-appdmin-foss-platform-design.md`.
