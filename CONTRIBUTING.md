# Contributing to Appdmin

Thank you for helping make self-hosted product operations more trustworthy.

1. Open an issue for substantial behavior or protocol changes.
2. Keep core generic. Product names, private schemas, provider credentials, and
   organization-specific assumptions belong in adapters, never fixtures or documentation.
3. Add a failing test before fixing a bug or implementing a behavior.
4. Run `deno task verify` before opening a pull request.
5. Document adapter permission changes and any migration or upgrade impact.

Contributions are accepted under AGPL-3.0-or-later. By submitting a contribution, you certify that
you have the right to license it under those terms.
