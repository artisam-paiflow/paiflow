#!/bin/sh
set -eu

# A failed migration must stop startup before the server accepts traffic.
node node_modules/prisma/build/index.js migrate deploy

# Replace the shell so Next.js receives Railway's SIGTERM directly.
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
