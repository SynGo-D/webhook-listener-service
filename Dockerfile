# Runtime image for webhook-listener.
#
# Three stages so the image that ships carries neither the TypeScript
# compiler nor the test dependencies: only the compiled dist/ and the
# packages it actually needs at runtime.
#
# The database migrations are copied in as well. They are not run by this
# image — a container that migrates on boot races with every other replica
# of itself — but they travel with the code that expects them, so the
# deployment can run them from the same image it is about to start.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json package.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5002

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY database/migrations ./database/migrations

USER node

EXPOSE 5002

# /ready, not /health: this service is only useful when it can reach both
# Postgres and RabbitMQ, and a webhook delivery accepted while the queue is
# unreachable is a pull request that never gets reviewed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5002/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
