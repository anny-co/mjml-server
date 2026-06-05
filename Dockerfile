FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Listen on a non-privileged port: the container runs as the non-root `node`
# user, which cannot bind ports < 1024 without CAP_NET_BIND_SERVICE.
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js index.js ./

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/healthz || exit 1

ENTRYPOINT ["node", "./index.js"]
