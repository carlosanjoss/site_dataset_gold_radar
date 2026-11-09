# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache tini \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder --chown=nextjs:nodejs /app/db/migration.sql ./db/migration.sql
COPY --from=builder --chown=nextjs:nodejs /app/scripts/check-db.mjs ./scripts/check-db.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/wait-for-db.mjs ./scripts/wait-for-db.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/smoke-test.mjs ./scripts/smoke-test.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/nli-smoke-test.mjs ./scripts/nli-smoke-test.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/user-admin-smoke-test.mjs ./scripts/user-admin-smoke-test.mjs
COPY --chown=nextjs:nodejs docker/entrypoint.sh /usr/local/bin/radar-entrypoint

RUN chmod 755 /usr/local/bin/radar-entrypoint

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/radar-entrypoint"]
