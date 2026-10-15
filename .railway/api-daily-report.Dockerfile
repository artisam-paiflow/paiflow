# Dedicated batch image: no Next build, app startup or database migrations.
FROM node:22.22.2-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
COPY patches ./patches
COPY prisma ./prisma
# tsx is a development dependency needed to execute the reporting scripts.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts \
    && pnpm db:generate
COPY tsconfig.json ./
COPY scripts/api-daily-cron.ts scripts/api-daily-cron-utils.ts ./scripts/
COPY lib ./lib
ENV NODE_ENV=production
CMD ["pnpm", "analytics:api-daily-cron"]
