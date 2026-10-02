FROM node:22.22.3-bookworm-slim

WORKDIR /app
ENV DB_PATH=/data/trip.db
ENV UPLOADS_DIR=/data/uploads

# The Railway build context is the repository root; install backend dependencies only.
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend --omit=dev

COPY backend/ ./backend/
COPY data/trip.db ./initial-trip.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "mkdir -p /data && if [ ! -f /data/trip.db ]; then cp /app/initial-trip.db /data/trip.db; fi && npm --prefix backend run start"]
