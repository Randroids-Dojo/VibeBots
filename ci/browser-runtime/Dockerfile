# syntax=docker/dockerfile:1.7

FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS node-runtime

RUN npm install --global pnpm@10.30.3

FROM mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948

LABEL org.opencontainers.image.source="https://github.com/Randroids-Dojo/VibeBots"
LABEL org.opencontainers.image.description="Pinned VibeBots Playwright CI runtime"

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/bin/pnpm /usr/local/bin/pnpm
COPY --from=node-runtime /usr/local/bin/pnpx /usr/local/bin/pnpx
COPY --from=node-runtime /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_STORE_DIR=/pnpm/store

RUN node --version | grep -Fx "v22.22.1" \
  && pnpm --version | grep -Fx "10.30.3"

WORKDIR /workspace
