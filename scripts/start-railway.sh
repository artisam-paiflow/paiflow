#!/bin/sh
set -eu

# Refuse an outdated runtime before migrations or application traffic.
node scripts/check-node-version.cjs

# A failed migration must stop startup before the server accepts traffic.
node node_modules/prisma/build/index.js migrate deploy

# Replace the shell so Next.js receives Railway's SIGTERM directly.
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
