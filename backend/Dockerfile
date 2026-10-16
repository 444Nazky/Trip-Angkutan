# Build: 2024-10-13 force-rebuild timestamp to invalidate cache
FROM node:22.22.3-bookworm-slim

# Install Python for native module builds (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV DB_PATH=/data/trip.db
ENV NODE_ENV=production

# Copy backend files from repo root context
COPY backend/package*.json ./
RUN npm ci

COPY backend/src/ ./src/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Uploads directory is set via Railway environment variable (UPLOADS_DIR)
CMD ["sh", "-c", "mkdir -p /data && node src/index.js"]
