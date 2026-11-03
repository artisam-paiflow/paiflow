# Official prebuilt Node includes the Brotli security backport; no Nix/Node source build.
# Pin the multi-platform image index so build and runtime use the same reviewed release.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
ENV COREPACK_HOME=/opt/corepack
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json pnpm-lock.yaml .npmrc prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/check-node-version.cjs ./scripts/check-node-version.cjs
RUN HUSKY=0 pnpm install --frozen-lockfile --prod=false

FROM dependencies AS build
COPY . .
# Railway exposes declared service variables as build arguments. Only public
# browser configuration and the public commit identifier belong in image layers.
ARG RAILWAY_GIT_COMMIT_SHA=dev
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_APP_ENV=local
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=
ARG NEXT_PUBLIC_SPLITTER_XLM_MIN=150
ARG NEXT_PUBLIC_SPLITTER_XLM_MAX=500
ARG NEXT_PUBLIC_SPLITTER_USDC_MIN=30
ARG NEXT_PUBLIC_SPLITTER_USDC_MAX=110
# Build-time schema parsing needs synthetic values, never deployment credentials.
# These apply only to this command and cannot connect to a real database.
RUN AUTH_SECRET=container-build-only-placeholder-at-least-32-characters \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build?schema=public \
    pnpm build \
    && rm -rf .next/cache .next/types .next/diagnostics .next/trace

FROM base AS runtime
ENV NODE_ENV=production
# Keep the installed Prisma CLI/generated client and TypeScript needed to load
# next.config.ts. Copy runtime files explicitly instead of shipping build sources.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/next.config.ts /app/tsconfig.json /app/prisma.config.ts ./
# The runtime Next config imports the shared framing policy.
COPY --from=build --chown=node:node /app/lib/csp.ts ./lib/csp.ts
COPY --from=build --chown=node:node /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /app/prisma/migrations ./prisma/migrations
COPY --from=build --chown=node:node /app/scripts/check-node-version.cjs /app/scripts/start-railway.sh ./scripts/
USER node
EXPOSE 3000
CMD ["sh", "scripts/start-railway.sh"]
