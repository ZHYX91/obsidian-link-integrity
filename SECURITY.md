# Security Policy

Link Integrity reads local Vault metadata and source text to produce diagnostics. It does not need
an account, upload Vault content, check external URLs, modify notes, or persist its derived graph.
A vulnerability that breaks those boundaries, exposes private content, permits unsafe file access,
or compromises distributed plugin assets should be reported privately.

## Reporting a vulnerability

Do not open a public issue with exploit details or private Vault data. If GitHub shows **Report a
vulnerability** for this repository, use the
[private advisory form](https://github.com/ZHYX91/obsidian-link-integrity/security/advisories/new).
If private vulnerability reporting is unavailable, request a private contact channel through the
maintainer information on the [repository owner's profile](https://github.com/ZHYX91) without
disclosing the vulnerability publicly.

Include only the information needed to reproduce and assess the report:

- affected Link Integrity version, tag, or commit;
- Obsidian version, operating system, and desktop or mobile environment;
- expected boundary, observed impact, and minimal reproduction steps;
- a sanitized proof of concept when useful;
- whether the issue is already public or appears to be actively exploited.

Remove credentials, personal paths, note contents, and unrelated `data.json` values. A minimal
disposable Vault is preferable to a real Vault export.

## Version and response scope

The repository manifest currently prepares version `0.1.2`; the highest annotated tag remains
`0.1.1` until that release is published. These facts do not claim a particular distribution
channel, deployment, or support lifetime. Reports should
state the exact affected revision; fixes are evaluated against the current default branch and
relevant tagged code.

There is no guaranteed response or remediation deadline. The maintainer will assess reproducibility,
impact, affected revisions, disclosure timing, and whether coordinated reporting to Obsidian or a
dependency maintainer is required. Please allow time for a fix and release decision before public
disclosure.

## Public reports

Non-sensitive hardening suggestions and already-public dependency advisories may use
[GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues). General feature requests,
external-link availability, and unsupported-host questions are not private security reports unless
they demonstrate a concrete confidentiality, integrity, or availability impact.
