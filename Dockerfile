FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# Retry/timeout longgar: jaringan kantor sering memutus unduhan tarball
# (ETIMEDOUT di tengah `npm ci`) sehingga build web gagal total.
RUN npm ci --no-audit --no-fund \
    --fetch-retries=5 \
    --fetch-retry-mintimeout=20000 \
    --fetch-retry-maxtimeout=120000 \
    --fetch-timeout=600000
COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/www /srv/mobile
COPY --from=build /app/www /srv/admin
RUN rm -rf /srv/mobile/admin /srv/admin/admin
COPY --from=build /app/www/admin/index.html /srv/admin/index.html
EXPOSE 8000 5173
CMD ["nginx", "-g", "daemon off;"]
