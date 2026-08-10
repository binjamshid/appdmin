# Security policy

## Reporting

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting for
this repository. Include affected version, impact, reproduction, and any suggested mitigation.

## Supported versions

Only the latest minor release receives security fixes before the first stable release.

## Trust model

Appdmin core owns credentials, authentication, authorization, action mediation, and audit history.
Adapters are subprocesses with manifest-scoped Deno permissions. Installing an adapter is a trust
decision: review its source pin, digest, and complete permission manifest.

Never include production credentials, customer data, prompts, model responses, private hostnames, or
organization-specific identifiers in an issue, test fixture, diagnostic bundle, or pull request.
