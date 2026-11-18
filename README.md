# Appdmin

Appdmin is a self-hosted operations console for independent software products. It builds a truthful,
source-aware view from App Store Connect, inference providers, OpenTelemetry, and installable
adapters without baking an organization's products or infrastructure into the core.

## Why Appdmin

- **Truthful metrics:** zero, unavailable, stale, partial, and no source remain distinct.
- **Adapter-owned catalog:** products come from source systems and retain provenance.
- **Inference accounting:** bundled OpenAI, Anthropic, Gemini, OpenRouter, and generic compatible
  providers; official provider totals stay authoritative.
- **Apple reporting:** App Store Connect discovers the live app catalog and, when a vendor number is
  configured, parses Apple's daily Summary Sales Report into currency-preserving units and proceeds.
- **Permissioned extensions:** every adapter runs in a capability-scoped Deno subprocess.
- **Safe administration:** mandatory two-factor sign-in, step-up for writes, idempotency, and an
  append-only audit trail.
- **One polished surface:** responsive, capability-aware dashboard and resumable GUI onboarding.
- **Two equal deployment paths:** Docker Compose and hardened native systemd.

## License

For Appdmin revisions publicly released by binjamshid beginning with adoption on `main`, the
[Binjamshid Public Fork License, Version 1.0](LICENSE) applies to material binjamshid has authority
to license. Separately licensed third-party material retains its terms and notices.

This license prohibits commercial use by or on behalf of for-profit organizations. If you edit
covered software, you must publish the corresponding source of each modified version under the same
license in a public version-control repository, including versions you only edit locally. Publish
within 30 calendar days of the edit or before distributing the version or allowing others to use it
as a service, whichever comes first, subject to the license's security-fix exception.

The [last AGPL revision] and earlier revisions released under [AGPL-3.0-or-later](LICENSE-AGPL-3.0)
remain available under their original terms. The AGPL permits commercial use subject to its
conditions. AGPL-only changes require separate permission from their copyright holders before
inclusion in a work released under the Binjamshid Public Fork License.

[last AGPL revision]: https://github.com/binjamshid/appdmin/tree/923cae2cab243be656b41cf649e926e752e4519a

## Quick start with Docker Compose

Requirements: Docker Engine with Compose v2.

```sh
cp .env.example .env
openssl rand -base64 32
# Edit .env: set APPDMIN_SECRET_KEY and strong database credentials.
docker compose up -d --build
docker compose exec appdmin appdmin admin create
```

Open `http://localhost:8787`, sign in, and follow the five onboarding steps. The first dashboard is
intentionally empty until an adapter discovers products or observations.

## Local development

Requirements: Deno 2 and PostgreSQL 16 or newer.

```sh
cp .env.example .env
set -a
. ./.env
set +a
deno task cli migrate
deno task cli admin create
deno task dev
```

Then open `http://localhost:8787`.

## CLI

Install the checkout as a local executable:

```sh
deno install --global --force --name appdmin \
  --allow-env --allow-net --allow-read --allow-write --allow-run --allow-sys ./src/cli.ts
```

Common commands:

```text
appdmin migrate
appdmin admin create
appdmin adapter list
appdmin adapter add openai --accept-permissions
appdmin adapter doctor openai
appdmin doctor
appdmin install --target docker --output ./generated
appdmin install --target systemd --output ./generated
appdmin backup --output ./backups/appdmin.dump
```

## Adapter model

The trusted core owns encrypted configuration, products, observations, policy, and audit. An adapter
declares capabilities and exact permissions in `appdmin.adapter.json`, then communicates with core
over JSON-RPC on stdin/stdout. Bundled integrations use the same contract as community integrations.

Remote package references must be pinned to a semantic JSR/npm version or a full Git commit. Any
manifest digest change disables the adapter until the owner reviews and accepts its permissions.

See [adapter authoring](docs/adapters.md) and [architecture](docs/architecture.md).

## Configuration

Only bootstrap settings are environment variables:

| Variable                        | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                  | Appdmin PostgreSQL connection                         |
| `APPDMIN_SECRET_KEY`            | Base64-encoded 32-byte AES key for encrypted settings |
| `APPDMIN_ORIGIN`                | Exact public origin used for CSRF and WebAuthn        |
| `APPDMIN_HOST` / `APPDMIN_PORT` | Bind address, defaults to `127.0.0.1:8787`            |
| `APPDMIN_BASE_PATH`             | Optional reverse-proxy path, defaults to `/`          |
| `APPDMIN_SOURCE_URL`            | Source archive/repository link shown in the GUI       |

Provider credentials, workspace settings, pricing, adapter schedules, and branding are managed in
the GUI/CLI and encrypted in PostgreSQL.

## Verification

```sh
deno task verify
docker compose config --quiet
deno task cli install --target systemd --output /tmp/appdmin-systemd --dry-run
```

Provider contract tests use synthetic fixtures and never production data. Host-dependent container
and systemd checks are documented separately in [installation](docs/install.md).

## Project documents

- [Architecture](docs/architecture.md)
- [Adapter SDK guide](docs/adapters.md)
- [Installation](docs/install.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Design system](DESIGN.md)
