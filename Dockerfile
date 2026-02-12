# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace package manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps (including devDeps for build)
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/core/ packages/core/
COPY packages/dashboard/ packages/dashboard/

# Build: shared → core → dashboard
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

RUN addgroup -S friday && adduser -S friday -G friday \
 && mkdir -p /home/friday/.secureyeoman/data /home/friday/.secureyeoman/workspace \
 && chown -R friday:friday /home/friday

WORKDIR /app

# Copy workspace package manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/dashboard/package.json packages/dashboard/

# Install production deps only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/dashboard/dist/ packages/dashboard/dist/

# Gateway port
EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:18789/health || exit 1

USER friday

CMD ["node", "packages/core/dist/cli.js"]
