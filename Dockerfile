FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
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
