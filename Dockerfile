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
COPY server.js ./
# server.js shares the wire protocol helpers with the browser
COPY src/js/netproto.js src/js/unitext.js src/js/unidata.js ./src/js/
COPY --from=builder /app/public ./public
ENV PORT=8050
EXPOSE 8050
USER node
CMD ["node", "server.js"]
