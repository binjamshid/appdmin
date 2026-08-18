export const ADAPTER_PROTOCOL_VERSION = "1.0";

export type Capability =
  | "catalog"
  | "metrics"
  | "costs"
  | "people"
  | "actions"
  | "mail"
  | "infrastructure"
  | "health"
  | "privacy_telemetry";

export type ObservationQuality =
  | "live"
  | "delayed"
  | "partial"
  | "estimated"
  | "stale"
  | "unavailable"
  | "no_source";

export interface AdapterPermissions {
  net?: string[];
  env?: string[];
  read?: string[];
  write?: string[];
  run?: string[];
}

export interface AdapterManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  entrypoint: string;
  protocol: string;
  description?: string;
  capabilities: Capability[];
  permissions: AdapterPermissions;
  configSchema?: Record<string, unknown>;
}

export interface DiscoveredProduct {
  externalId: string;
  name: string;
  kind: "app" | "service" | "model" | "site" | "other";
  platform?: string;
  iconUrl?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CatalogProduct extends DiscoveredProduct {
  id: string;
  adapterInstanceId: string;
  displayName: string;
  groupName: string | null;
  notes: string | null;
  hidden: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;
}

export interface Observation {
  adapterInstanceId: string;
  productId?: string;
  metric: string;
  value: number | string | boolean | Record<string, unknown> | null;
  unit?: string;
  currency?: string;
  intervalStart?: string;
  intervalEnd?: string;
  collectedAt: string;
  quality: ObservationQuality;
  source: string;
  sourceUrl?: string;
  definition: string;
  timezone?: string;
  notes?: string[];
  providerRecordId?: string;
  authority?: "provider" | "telemetry" | "configured";
}

export interface AdapterHealth {
  status: "healthy" | "degraded" | "failing" | "disabled" | "incompatible";
  checkedAt: string;
  latencyMs?: number;
  message?: string;
}

export interface RpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
