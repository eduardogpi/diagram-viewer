# syntax=docker/dockerfile:1
# Workbench Web — build standalone do Next.js com SQLite (Prisma)
# Stage 1: deps
# Debian slim (glibc + OpenSSL 3) — o Prisma precisa de libssl; Alpine (musl/OpenSSL 1.1) quebra.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Evita tentar baixar binários de postinstall de pacotes opcionais
RUN npm ci --ignore-scripts

# Stage 2: build
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Gera o Prisma Client (necessário para o build do Next)
RUN npx prisma generate
# Build standalone (requer output: 'standalone' no next.config.ts)
RUN npm run build

# Stage 3: runner
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

RUN groupadd -r nodejs && useradd -m -u 1001 nextjs -g nodejs

# Saída standalone do Next.js
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: schema + migrations + engine (para `prisma migrate deploy` no entrypoint)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Entrypoint: roda migrations e sobe o servidor
COPY docker/entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data && chown -R nextjs:nodejs /app /data

USER nextjs
# wget para o healthcheck do Compose estar disponível no container

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
