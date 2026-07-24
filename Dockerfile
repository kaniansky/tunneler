FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY build.js ./
COPY src ./src
RUN npm run build

FROM node:lts-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY --from=builder /app/public ./public
ENV PORT=8042
# HTTPS_PORT defaults to PORT+1 (8043) if unset - see server.js's self-signed cert setup
EXPOSE 8042 8043
# server.js writes certs/ under /app at runtime (see ensureSelfSignedCert()), so the
# non-root "node" user (built into this image) needs ownership of the whole tree, not
# just read access. public/ was already built above - no src/, build.js, or esbuild ship
# in this final image at all.
RUN chown -R node:node /app
USER node
CMD ["node", "server.js"]
