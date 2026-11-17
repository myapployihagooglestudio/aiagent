# Stage 1: Build TypeScript server bundle using devDependencies (esbuild, typescript)
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json firebase-applet-config.json server.ts ./
COPY server ./server

RUN npm run lint && npm run build

# Stage 2: Minimal production runtime with ffmpeg and production-only dependencies
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY firebase-applet-config.json ./

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

CMD ["npm", "start"]
