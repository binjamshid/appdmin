import type { CatalogProduct, DiscoveredProduct } from "./types.ts";

export function reconcileCatalog(
  adapterInstanceId: string,
  existing: CatalogProduct[],
  discovered: DiscoveredProduct[],
  now = new Date().toISOString(),
): CatalogProduct[] {
  const current = new Map(existing.map((product) => [product.externalId, product]));
  const seen = new Set<string>();
  const result: CatalogProduct[] = [];
  for (const source of discovered) {
    if (!source.externalId.trim()) throw new Error("discovered product externalId is required");
    if (seen.has(source.externalId)) {
      throw new Error(`duplicate discovered product: ${source.externalId}`);
    }
    seen.add(source.externalId);
    const previous = current.get(source.externalId);
    result.push({
      ...source,
      id: previous?.id ?? crypto.randomUUID(),
      adapterInstanceId,
      displayName: previous?.displayName ?? source.name,
      groupName: previous?.groupName ?? null,
      notes: previous?.notes ?? null,
      hidden: previous?.hidden ?? false,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
      missingSince: null,
    });
  }
  for (const previous of existing) {
    if (!seen.has(previous.externalId)) {
      result.push({ ...previous, missingSince: previous.missingSince ?? now });
    }
  }
  return result;
}
