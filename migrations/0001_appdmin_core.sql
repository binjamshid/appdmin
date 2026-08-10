begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  display_name text not null,
  password_hash text not null,
  password_changed_at timestamptz not null default now(),
  totp_secret_enc bytea,
  totp_confirmed_at timestamptz,
  totp_last_step bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists admin_accounts_username_key on admin_accounts (lower(username));

create table if not exists webauthn_credentials (
  id text primary key,
  account_id uuid not null references admin_accounts(id) on delete cascade,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  nickname text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references admin_accounts(id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('registration', 'authentication')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists recovery_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references admin_accounts(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references admin_accounts(id) on delete cascade,
  token_sha256 bytea not null unique,
  csrf_token text not null,
  ip inet,
  user_agent text,
  factor2 text not null check (factor2 in ('webauthn', 'totp', 'recovery')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  stepup_at timestamptz
);

create table if not exists pending_logins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references admin_accounts(id) on delete cascade,
  token_sha256 bytea not null unique,
  ip inet,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists login_attempts (
  id bigserial primary key,
  username text,
  ip inet,
  outcome text not null check (outcome in ('password_ok', 'password_fail', 'factor2_ok', 'factor2_fail', 'locked')),
  at timestamptz not null default now()
);

create table if not exists workspace_settings (
  singleton boolean primary key default true check (singleton),
  name text not null default 'Appdmin',
  compact_name text not null default 'Appdmin',
  accent text not null default 'indigo',
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);
insert into workspace_settings (singleton) values (true) on conflict do nothing;

create table if not exists onboarding_state (
  singleton boolean primary key default true check (singleton),
  current_step text not null default 'workspace',
  completed_steps text[] not null default '{}',
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into onboarding_state (singleton) values (true) on conflict do nothing;

create table if not exists encrypted_settings (
  namespace text not null,
  key text not null,
  value_enc jsonb not null,
  is_secret boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

create table if not exists adapter_instances (
  id uuid primary key default gen_random_uuid(),
  adapter_id text not null,
  name text not null,
  source text not null,
  package_root text not null,
  source_digest text not null,
  manifest jsonb not null,
  accepted_manifest_digest text,
  enabled boolean not null default false,
  health_status text not null default 'disabled',
  health_message text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists adapter_instances_adapter_id_key on adapter_instances(adapter_id);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  adapter_instance_id uuid not null references adapter_instances(id) on delete cascade,
  external_id text not null,
  source_name text not null,
  display_name text not null,
  kind text not null,
  platform text,
  icon_url text,
  source_url text,
  group_name text,
  notes text,
  hidden boolean not null default false,
  metadata jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  unique(adapter_instance_id, external_id)
);

create table if not exists product_links (
  logical_product_id uuid not null references products(id) on delete cascade,
  source_product_id uuid not null references products(id) on delete cascade,
  primary key(logical_product_id, source_product_id)
);

create table if not exists observations (
  id bigserial primary key,
  adapter_instance_id uuid not null references adapter_instances(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  metric text not null,
  value jsonb,
  unit text,
  currency text,
  interval_start timestamptz,
  interval_end timestamptz,
  collected_at timestamptz not null,
  quality text not null check (quality in ('live','delayed','partial','estimated','stale','unavailable','no_source')),
  source text not null,
  source_url text,
  definition text not null,
  timezone text,
  notes jsonb not null default '[]',
  provider_record_id text,
  authority text,
  created_at timestamptz not null default now()
);
create index if not exists observations_lookup_idx on observations(adapter_instance_id, metric, product_id, currency, collected_at desc);

create table if not exists ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  adapter_instance_id uuid not null references adapter_instances(id) on delete cascade,
  name text not null,
  token_sha256 bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists action_runs (
  id uuid primary key default gen_random_uuid(),
  adapter_instance_id uuid not null references adapter_instances(id),
  product_id uuid references products(id),
  action_key text not null,
  idempotency_key text not null unique,
  input_summary jsonb not null default '{}',
  status text not null check (status in ('pending','running','succeeded','failed','timed_out')),
  result_summary jsonb,
  error text,
  requested_by uuid references admin_accounts(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  account_id uuid,
  actor text,
  ip inet,
  action text not null,
  target text,
  detail jsonb not null default '{}',
  outcome text not null default 'ok'
);
create index if not exists audit_log_at_idx on audit_log(at desc);

create or replace function audit_log_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
drop trigger if exists audit_log_no_mutate on audit_log;
create trigger audit_log_no_mutate before update or delete on audit_log
for each row execute function audit_log_is_append_only();

commit;
