#!/bin/sh
set -e

# DATABASE_URL já vem do compose (file:/data/dev.db por padrão)
: "${DATABASE_URL:=file:/data/dev.db}"

echo "[entrypoint] Aplicando migrations Prisma..."
# Na imagem standalone não há node_modules/.bin — chama o CLI direto via node.
/usr/local/bin/node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] Subindo servidor..."
exec "$@"
