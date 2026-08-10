# Writing an Appdmin adapter

An adapter contains a manifest and TypeScript entrypoint:

```text
my-adapter/
├── appdmin.adapter.json
└── main.ts
```

The manifest declares its stable lowercase ID, semantic version, protocol major, capabilities,
configuration schema, and complete runtime permission set. Package sources must be local or pinned
to an immutable JSR/npm version or 40-character Git commit.

JSR and npm packages must export both `appdmin.adapter.json` and the manifest's entrypoint as
package subpaths. Git and local packages keep both files at the repository/package root. Appdmin
resolves and caches the complete entrypoint dependency graph when the owner installs the adapter,
then runs it in cached-only mode.

The entrypoint reads JSON-RPC requests one line at a time and writes exactly one JSON response line.
Use `adapters/_shared/runtime.ts` as a minimal reference. Supported capability methods are
documented by the types in `src/core/types.ts`.

Adapter responses must include source, definition, collection time, and quality. A missing value is
`null` with `unavailable` or `no_source`; it is never represented as zero. Write methods must honor
the core-provided idempotency key.

Permission changes create a new manifest digest and require the owner to accept the manifest again.
