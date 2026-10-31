# Build context is the repository root:  docker build -f server/Dockerfile -t lueckenfueller-api .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# The web workspace is not part of the image, but npm needs its manifest to read the lockfile.
COPY web/package.json web/
RUN npm ci --workspace=shared --workspace=server
COPY shared/ shared/
COPY server/ server/
RUN npm run build -w shared && npm run build -w server

FROM node:24-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/Dr-Nerdlove/gapfinder" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=shared --workspace=server && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/dist/index.js"]
