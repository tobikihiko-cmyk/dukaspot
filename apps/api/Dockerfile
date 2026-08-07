FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.json tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/auth packages/auth
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/database packages/database
COPY packages/observability packages/observability
COPY packages/security packages/security
RUN npm run build -w @dukaspot/api -- --force

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S dukaspot && adduser -S dukaspot -G dukaspot

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci --omit=dev --workspaces --include-workspace-root

COPY apps/api/src apps/api/src
COPY packages/core packages/core
COPY packages/database packages/database
COPY --from=build /app/packages/auth/dist packages/auth/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/packages/security/dist packages/security/dist

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER dukaspot
CMD ["node", "apps/api/dist/main.js"]
