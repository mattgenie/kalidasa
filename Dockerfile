# ============================================================================
# Kalidasa: Multi-stage Docker Build
# ============================================================================
# Optimized for AWS App Runner deployment
# Final image: ~300MB (Node 20 Alpine + compiled app)
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1: Builder
# ----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.base.json ./

# Copy all package.json files for workspace resolution
COPY apps/search-api/package.json ./apps/search-api/
COPY packages/types/package.json ./packages/types/
COPY packages/cao-generator/package.json ./packages/cao-generator/
COPY packages/enrichment/package.json ./packages/enrichment/
COPY packages/facet-libraries/package.json ./packages/facet-libraries/
COPY packages/merger/package.json ./packages/merger/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/ ./apps/
COPY packages/ ./packages/

# Build the entire monorepo (turbo handles dependency order)
RUN pnpm build

# ----------------------------------------------------------------------------
# Stage 2: Production Runner
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner

# Install pnpm for production install
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 kalidasa

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/search-api/package.json ./apps/search-api/
COPY packages/types/package.json ./packages/types/
COPY packages/cao-generator/package.json ./packages/cao-generator/
COPY packages/enrichment/package.json ./packages/enrichment/
COPY packages/facet-libraries/package.json ./packages/facet-libraries/
COPY packages/merger/package.json ./packages/merger/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder --chown=kalidasa:nodejs /app/apps/search-api/dist ./apps/search-api/dist
COPY --from=builder --chown=kalidasa:nodejs /app/packages/types/dist ./packages/types/dist
COPY --from=builder --chown=kalidasa:nodejs /app/packages/cao-generator/dist ./packages/cao-generator/dist
COPY --from=builder --chown=kalidasa:nodejs /app/packages/enrichment/dist ./packages/enrichment/dist
COPY --from=builder --chown=kalidasa:nodejs /app/packages/facet-libraries/dist ./packages/facet-libraries/dist
COPY --from=builder --chown=kalidasa:nodejs /app/packages/merger/dist ./packages/merger/dist

# Set production environment
ENV NODE_ENV=production
ENV PORT=3200

# Expose the API port
EXPOSE 3200

# Switch to non-root user
USER kalidasa

# Health check for App Runner
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3200/health || exit 1

# Start the server
WORKDIR /app/apps/search-api
CMD ["node", "dist/index.js"]
