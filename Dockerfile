# Multi-stage build for efficient container size
FROM node:26-alpine AS builder

# Build arguments
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (--ignore-scripts prevents 'prepare' from running before source is copied)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:26-alpine AS production

# Create a non-root user for security
RUN addgroup -g 1001 -S qbo && \
    adduser -S qbo -u 1001 -G qbo

# Set working directory
WORKDIR /app

# Copy package files and built application from builder stage
COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Prune dev dependencies (avoids re-installing git deps which need build tools)
RUN npm prune --omit=dev && npm cache clean --force

# Create logs directory
RUN mkdir -p /app/logs && chown -R qbo:qbo /app

# Switch to non-root user
USER qbo

# Expose port
EXPOSE 8080

# Health check against the actual HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables.
# 0.0.0.0 is the interface inside the container. Startup still refuses to run
# without a real CONDUIT_S2S_SECRET. MCP_ALLOW_INSECURE_DEV=1 forces 127.0.0.1
# even while this host is 0.0.0.0. Gateway mode reads the access token and
# realm id from X-Qbo-* headers only.
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV LOG_FORMAT=json
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
ENV AUTH_MODE=gateway

# Define volume for logs
VOLUME ["/app/logs"]

# Start the application directly (HTTP transport doesn't need the stdio wrapper)
CMD ["node", "dist/index.js"]

# Build arguments for runtime
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Labels for metadata
LABEL maintainer="engineering@wyre.ai"
LABEL version="${VERSION}"
LABEL description="QuickBooks Online MCP Server - Model Context Protocol server for QuickBooks Online"
LABEL org.opencontainers.image.title="qbo-mcp"
LABEL org.opencontainers.image.description="Model Context Protocol server for QuickBooks Online accounting integration"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/WYRE-AI/qbo-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/WYRE-AI/qbo-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/WYRE-AI/qbo-mcp/pkgs/container/qbo-mcp"
LABEL org.opencontainers.image.vendor="Wyre Technology"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL io.modelcontextprotocol.server.name="io.github.WYRE-AI/qbo-mcp"
