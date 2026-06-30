FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build the Vite client
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built client + server source
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/mcp ./mcp
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./

# Data directory — mount a volume here for persistence
RUN mkdir -p /app/data /app/backups
VOLUME ["/app/data", "/app/backups"]

ENV PORT=3001
ENV NODE_ENV=production
# Keep the SQLite DB inside the mounted /app/data volume so it survives rebuilds
ENV DATABASE_PATH=/app/data/data.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/ping', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npx", "tsx", "src/server/index.ts"]
