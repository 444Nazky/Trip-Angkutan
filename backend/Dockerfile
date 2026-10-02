FROM node:22.22.3-bookworm-slim

WORKDIR /app

# better-sqlite3 is declared by the backend and may need a native build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# With Railway's /backend root directory, db.js resolves ../../data/trip.db to
# /data/trip.db. Keep database and uploads on persistent Railway volumes.
VOLUME ["/data", "/app/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
