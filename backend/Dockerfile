FROM node:22.22.3-bookworm-slim

WORKDIR /app/backend
ENV DB_PATH=/data/trip.db
ENV UPLOADS_DIR=/data/uploads

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "mkdir -p /data && if [ ! -f /data/trip.db ]; then cp /app/initial-trip.db /data/trip.db; fi && npm run start"]
