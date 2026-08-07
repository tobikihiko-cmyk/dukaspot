FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.json tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/observability packages/observability
RUN npm run build -w @dukaspot/worker -- --force

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S dukaspot && adduser -S dukaspot -G dukaspot

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci --omit=dev --workspaces --include-workspace-root

COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist

USER dukaspot
CMD ["node", "apps/worker/dist/main.js"]
