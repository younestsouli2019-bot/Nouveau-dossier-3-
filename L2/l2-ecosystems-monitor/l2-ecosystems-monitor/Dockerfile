FROM node:20-slim

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./
RUN npm install --production

# Copy source code
COPY . .

# Create directories
RUN mkdir -p logs data

# Non-root user
RUN chown -R node:node /app
USER node

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the monitor
CMD ["node", "src/index.js"]
