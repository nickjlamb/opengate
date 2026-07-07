# Security Policy

## Reporting a vulnerability

Please report suspected security issues privately to **info@pharmatools.ai**
rather than opening a public issue. Include a description, reproduction steps, and
the affected surface/version. We aim to acknowledge reports within a few working
days and will keep you updated on remediation.

## Scope

OpenGATE is a local, dependency-free evaluation tool. It reads gold cases and, for
online scorers, calls a system-under-test through an adapter you configure. It
stores nothing remotely and ships no telemetry. The most relevant concerns are:

- handling of credentials passed to adapters via environment variables (never
  commit them; the HTTP adapter interpolates `${ENV}` at runtime so tokens stay
  out of config files);
- untrusted gold cases or adapters loaded from third-party repositories.

## Supported versions

OpenGATE is pre-1.0; security fixes land on the latest published version of each
package (`@pharmatools/opengate`, `opengate-grounding`, `@pharmatools/opengate-mcp`,
and the `pharmatools/opengate` image). Please upgrade before reporting.
