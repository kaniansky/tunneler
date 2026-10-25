# Stage 1: build src/ -> public/ (minified) with the dev dependencies (esbuild)
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY build.js ./
COPY src ./src
RUN npm run build

# Stage 2: production deps + server + built public/ only
FROM node:lts-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js challenge-worker.js ./
# server.js shares the wire protocol helpers with the browser (ES modules: src/package.json says so); the weekly
# challenge's replay check (challenge-worker.js) runs the game's engine, computer players, modes and English texts
COPY src/package.json ./src/
COPY src/js ./src/js
COPY src/lang ./src/lang
COPY --from=builder /app/public ./public
ENV PORT=8050
# shared replays (POST /api/replays): a folder the server may write - a volume keeps them across restarts
ENV REPLAY_DIR=/app/shared-replays
RUN mkdir -p /app/shared-replays && chown node /app/shared-replays
EXPOSE 8050
USER node
CMD ["node", "server.js"]
