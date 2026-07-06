# syntax=docker/dockerfile:1
#
# OpenGATE — deterministic, gold-anchored evaluation for evidence-grounded AI.
# CPU-only by design: no CUDA, no GPU, no LLM judge. The image is just the Node
# CLI and its bundled gold sets, so it stays small and runs anywhere.
#
# Build:   docker build -t pharmatools/opengate .
# Pin:     docker build --build-arg OPENGATE_VERSION=0.9.0 -t pharmatools/opengate:0.9.0 .
#
# Self-test (runs the bundled offline suite):
#   docker run --rm pharmatools/opengate
#
# Evaluate your own system (mount your repo, bring your own gold sets):
#   docker run --rm -v "$PWD:/work" pharmatools/opengate --datasets ./gold --ci
#
FROM node:22-alpine

# Which published version of @pharmatools/opengate to bake in.
ARG OPENGATE_VERSION=latest

LABEL org.opencontainers.image.title="OpenGATE" \
      org.opencontainers.image.description="Deterministic, gold-anchored evaluation for evidence-grounded AI — no LLM judge. CPU-only." \
      org.opencontainers.image.source="https://github.com/nickjlamb/opengate" \
      org.opencontainers.image.url="https://www.pharmatools.ai/opengate" \
      org.opencontainers.image.documentation="https://github.com/nickjlamb/opengate/blob/main/docs/GETTING-STARTED.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="PharmaTools.AI"

# Install the CLI globally straight from npm. The package has zero runtime
# dependencies, so this is a single small layer with nothing to compile.
RUN npm install -g "@pharmatools/opengate@${OPENGATE_VERSION}" \
    && npm cache clean --force

# Run unprivileged (the node base image ships a non-root `node` user) and give
# it a writable working directory for results.
RUN mkdir -p /work && chown -R node:node /work
USER node
WORKDIR /work

# A bare `docker run` executes the bundled offline suite as an instant self-test.
# Mount a repo at /work and append flags (--datasets, --adapter, --ci, …) to
# evaluate your own system. To write results back to a bind mount, add
# `--user "$(id -u):$(id -g)"` so file ownership matches the host.
ENTRYPOINT ["opengate"]
