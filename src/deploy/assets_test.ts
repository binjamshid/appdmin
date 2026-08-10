import assert from "node:assert/strict";

Deno.test("Compose has health, persistence, and least-privilege controls", async () => {
  const compose = await Deno.readTextFile(new URL("../../compose.yaml", import.meta.url));
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \["ALL"\]/);
  assert.match(compose, /appdmin-postgres:/);
  assert.match(compose, /appdmin-data:/);
  assert.match(compose, /APPDMIN_ADAPTER_ROOT: \/var\/lib\/appdmin\/adapters/);
});

Deno.test("systemd unit is non-root and hardened", async () => {
  const unit = await Deno.readTextFile(
    new URL("../../deploy/appdmin.service", import.meta.url),
  );
  assert.match(unit, /User=appdmin/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /PrivateDevices=yes/);
  assert.match(unit, /Environment=DENO_DIR=\/var\/lib\/appdmin\/deno-cache/);
  assert.doesNotMatch(unit, /User=root/);
});

Deno.test("container entrypoint prepares a writable cache and migration permissions", async () => {
  const entrypoint = await Deno.readTextFile(
    new URL("../../deploy/container-entrypoint.sh", import.meta.url),
  );
  assert.match(entrypoint, /deno cache/);
  assert.match(entrypoint, /--allow-sys/);
});

Deno.test("CLI serve command invokes the exported server entrypoint", async () => {
  const cli = await Deno.readTextFile(new URL("../cli.ts", import.meta.url));
  const main = await Deno.readTextFile(new URL("../main.ts", import.meta.url));
  assert.match(main, /export function serve/);
  assert.match(cli, /const \{ serve \} = await import\("\.\/main\.ts"\)/);
  assert.match(cli, /serve\(\)/);
});

Deno.test("CI supplies placeholders for Compose-only validation", async () => {
  const workflow = await Deno.readTextFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
  );
  assert.match(workflow, /POSTGRES_PASSWORD: ci-compose-only/);
  assert.match(workflow, /APPDMIN_SECRET_KEY: A{43}=/);
  assert.match(workflow, /sudo ln -sf .*command -v deno.* \/usr\/bin\/deno/);
});
