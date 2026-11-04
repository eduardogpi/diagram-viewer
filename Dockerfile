# syntax=docker/dockerfile:1
# Workbench Web — build standalone do Next.js com SQLite (Prisma)
# Stage 1: deps
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Evita tentar baixar binários de postinstall de pacotes opcionais
RUN npm ci --ignore-scripts

# Stage 2: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Gera o Prisma Client (necessário para o build do Next)
RUN npx prisma generate
# Build standalone (requer output: 'standalone' no next.config.ts)
RUN npm run build

# Stage 3: runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# OpenSSL é necessário para checksum/cripto do Prisma
RUN apk add --no-cache libc6-compat openssl

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

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
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
