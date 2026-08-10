#!/bin/sh
set -eu

deno cache /app/src/cli.ts /app/src/main.ts /app/adapters/*/main.ts
deno run --allow-env --allow-net --allow-read --allow-sys /app/src/cli.ts migrate
exec appdmin "$@"
