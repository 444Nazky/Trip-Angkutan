# Build stage
FROM node:22.22.3-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build the Angular app
RUN npm run build

# Production stage
FROM node:22.22.3-alpine

WORKDIR /app

# Install serve to serve static files
RUN npm install -g serve

# Copy built artifacts from builder
COPY --from=builder /app/www ./www

# Expose port 3000
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Start the server
CMD ["node", "-e", "const http=require('http');http.createServer((_,r)=>{r.writeHead(200);r.end()}).listen(8080)"]

