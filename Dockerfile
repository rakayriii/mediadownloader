# Dockerfile - Vercel Container/Fluid Compute
# Installs yt-dlp and FFmpeg inside the container for production use.
# Local development continues to work via config.ts resolution logic.

FROM node:22-alpine AS base

# Install system dependencies: yt-dlp, ffmpeg, python3, ca-certificates
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version

WORKDIR /app

# Install ALL dependencies (including devDependencies needed for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune devDependencies for smaller production image
RUN npm prune --production

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