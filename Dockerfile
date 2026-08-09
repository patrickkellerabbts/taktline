# syntax=docker/dockerfile:1.7

# ─── Stage 1: Dependencies ─────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# openssl wird von Prisma benötigt, libc6-compat für native Module
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

# ─── Stage 2: Builder ──────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy DATABASE_URL für die Build-Phase: prisma.config.ts erwartet diese
# ENV-Variable beim Laden, auch wenn `prisma generate` und `next build`
# selbst keine echte DB-Verbindung brauchen. Runtime wird die URL aus dem
# Container-Env (compose.prod.yml) überschrieben.
ENV DATABASE_URL="postgresql://build:build@build:5432/build?schema=public"

# Git-SHA für die /about-Seite. Das .git-Verzeichnis ist in .dockerignore
# ausgeschlossen, daher kann next.config.ts den SHA nicht selbst lesen.
# Der Build-Aufrufer (compose.prod.yml oder direkter docker build) gibt ihn
# via --build-arg BUILD_SHA=... durch.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA

RUN npx prisma generate
RUN npm run build

# ─── Stage 3: Prisma-CLI ───────────────────────────────────────────────────
# Schlankes Layer mit nur prisma + dotenv. Ohne package.json-Kontext damit
# nicht alle App-Deps mit-installiert werden. Pruning einzelner Submodule
# (@prisma/dev, studio-core etc.) ist NICHT möglich — der prisma-CLI-Bundle
# referenziert sie alle eager beim Load.
FROM node:22-alpine AS prisma-cli
WORKDIR /opt/prisma-cli
RUN apk add --no-cache libc6-compat openssl && \
    npm init -y >/dev/null && \
    npm install --no-package-lock --omit=optional --omit=peer \
      prisma@7.8.0 dotenv@17.4.2 && \
    npm cache clean --force

# ─── Stage 4: Runner ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3043
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# ── Standalone Build (Next.js Runtime, ~120 MB) ──
# WORKDIR /app — hier liegen server.js + .next/static + pruned node_modules
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# ── Prisma-CLI separat in /opt/prisma-cli ──
# Migrations + Config liegen mit drin damit Node-Module-Resolution für
# `@prisma/config` und `dotenv` aus dem prisma-cli node_modules klappt
# (wäre nicht der Fall wenn prisma.config.ts in /app läge, denn dort fehlen
# diese Deps im Standalone-Bundle).
WORKDIR /opt/prisma-cli
COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Entrypoint zurück in /app
WORKDIR /app
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3043

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
