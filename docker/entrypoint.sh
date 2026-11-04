#!/bin/sh
set -e

# DATABASE_URL já vem do compose (file:/data/dev.db por padrão)
: "${DATABASE_URL:=file:/data/dev.db}"

echo "[entrypoint] Aplicando migrations Prisma..."
npx prisma migrate deploy

echo "[entrypoint] Subindo servidor..."
exec "$@"
