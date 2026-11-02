# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/Unitfield/unitfield-sdk/security/advisories/new) from this repository's **Security** tab. Include the affected package and version, the impact, steps to reproduce and the revision you tested. Redact access tokens, client secrets, webhook secrets and any personal or payment data.

## Supported versions

Fixes go into the latest published version of each package.

## Scope

This repository holds client SDKs. Reports may cover, for example:

- OAuth authorization, PKCE and token handling in the SDK;
- webhook signature verification and replay checks;
- request signing and anything that could leak a credential.

Vulnerabilities in the Unitfield API or apps can be reported the same way; they are routed to the right team.
