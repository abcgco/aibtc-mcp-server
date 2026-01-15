# Build stage
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Production stage
FROM oven/bun:1.2-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S stx402 && \
    adduser -S stx402 -u 1001 -G stx402

# Copy node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Create data directory for wallet storage
RUN mkdir -p /data && chown -R stx402:stx402 /data

# Set environment variables
ENV NODE_ENV=production
ENV DOCKER=true
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NETWORK=testnet

# Switch to non-root user
USER stx402

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run the server
CMD ["bun", "run", "src/server.ts"]
