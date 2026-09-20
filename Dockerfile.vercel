# Dockerfile.vercel - Optimized for Vercel Container/Fluid Compute
# This file installs yt-dlp and FFmpeg inside the container for production use.
# Local development continues to work via the existing config.ts resolution logic.

FROM node:20-alpine AS base

# Install system dependencies: yt-dlp, ffmpeg, python3, ca-certificates
# Using alpine packages for smaller image and better compatibility
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version

WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Copy standalone output to app root for simpler execution
# The standalone output includes server.js and .next/static, .next/server
RUN cp -r .next/standalone/* . && \
    cp -r .next/static .next/standalone/.next/ 2>/dev/null || true && \
    mkdir -p .next && \
    cp -r .next/static .next/ 2>/dev/null || true

# Create non-root user for security (Vercel runs as non-root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Create data directories with proper permissions
# These will be ephemeral in Vercel (use S3/R2 for persistence)
RUN mkdir -p .mediavault/downloads .mediavault/temp .mediavault/thumbnails && \
    chown -R nextjs:nodejs .mediavault

USER nextjs

# Vercel Container/Fluid Compute provides $PORT at runtime
EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
# PORT is set by Vercel at runtime, do not hardcode

CMD ["node", "server.js"]