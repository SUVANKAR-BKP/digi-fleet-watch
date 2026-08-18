# ---- base: enables pnpm via Corepack (reads exact version from package.json) ----
FROM node:20-alpine AS base
RUN corepack enable

# ---- deps: install dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: compile the Next.js app ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner: production image ----
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/agent ./agent
# Migrations are read at runtime by src/lib/migrate.ts. docker-compose only
# applies drizzle/ on a brand-new Postgres volume, so the app re-applies them
# itself to bring an existing volume up to date.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]