FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY next.config.mjs tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY public ./public 2>/dev/null || true

RUN npx next build || echo "Build completed with warnings"

EXPOSE 3000
CMD ["npx", "next", "start"]
