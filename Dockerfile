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
COPY server.js accounts.js challenge-worker.js ./
# server.js shares the wire protocol helpers with the browser (ES modules: src/package.json says so); the daily
# challenge's replay check (challenge-worker.js) runs the game's engine, computer players, modes and English texts
COPY src/package.json ./src/
COPY src/js ./src/js
COPY src/lang ./src/lang
COPY --from=builder /app/public ./public
ENV PORT=8050
# replays, maps, accounts, challenges, state (README.md, Where the server keeps things): a folder per kind in
# DATA_DIR for every kind without an S3 bucket - a volume keeps them across restarts
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node /app/data
EXPOSE 8050
USER node
CMD ["node", "server.js"]
