# Installation

## Docker Compose

Docker Compose is supported on Linux and macOS on amd64 and arm64.

```sh
cp .env.example .env
openssl rand -base64 32
# Put the generated key and a strong database password in .env.
docker compose up -d
docker compose exec appdmin appdmin admin create
```

Open the configured `APPDMIN_ORIGIN`. The GUI begins at Workspace onboarding after the first secure
sign-in.

## Native systemd

Native installation targets Debian 12, Ubuntu 24.04, and compatible systemd distributions.

```sh
deno task cli install --target systemd --output ./generated
```

Review the generated environment and unit files. Install Deno and PostgreSQL, create a locked
`appdmin` service user, place the repository at `/opt/appdmin`, create `/var/lib/appdmin`, and
install the unit. Run migrations and owner creation as the service user before enabling the service.

The service unit is hardened and never runs as root. Put TLS termination in a reverse proxy and set
`APPDMIN_ORIGIN` to the exact public HTTPS origin so WebAuthn and origin checks remain bound.

## CLI installation

From a release checkout:

```sh
deno install --global --force --name appdmin \
  --allow-env --allow-net --allow-read --allow-write --allow-run --allow-sys ./src/cli.ts
appdmin help
```

Run `appdmin doctor` after configuring the environment.
